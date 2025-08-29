class HanimeProvider extends AnimeProvider {
  private baseUrl = 'https://hanime1.me';
  private fallbackUrls = ['https://hanime.tv', 'https://hanime1.tv'];
  private headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
  };
  
  private cache = new Map<string, any>();
  private cacheTimeout = 5 * 60 * 1000;

  getSettings() {
    return {
      episodeServers: ['default', 'backup'],
      supportsDub: false
    };
  }

  private async getCached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    
    const data = await fetcher();
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }

  private resolveUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return this.baseUrl + url;
    return this.baseUrl + '/' + url;
  }

  private getVideoType(url: string): string {
    if (url.includes('.m3u8') || url.includes('m3u8')) return 'm3u8';
    if (url.includes('.mp4')) return 'mp4';
    if (url.includes('.mkv')) return 'mkv';
    return 'auto';
  }

  // 🔧 修复：使用原生fetch替换axios
  private async requestWithFallback(endpoint: string): Promise<Response> {
    const urls = [this.baseUrl, ...this.fallbackUrls];
    
    for (const url of urls) {
      try {
        const response = await fetch(`${url}${endpoint}`, { 
          headers: { ...this.headers, 'Referer': url },
          method: 'GET'
        });
        
        if (response.ok) {
          this.baseUrl = url;
          return response;
        }
      } catch (error) {
        console.log(`Failed to connect to ${url}, trying next...`);
        continue;
      }
    }
    throw new Error('All domains failed');
  }

  // 🔧 修复：简化HTML解析，避免cheerio依赖
  private parseHtml(html: string, selector: string): any[] {
    const results: any[] = [];
    
    // 使用正则表达式替代cheerio
    if (selector === '.search-results') {
      const itemRegex = /<div[^>]*class=\"[^\"]*search-item[^\"]*\"[\\s\\S]*?<\\/div>/g;
      let match;
      while ((match = itemRegex.exec(html)) !== null) {
        const item = match[0];
        const titleMatch = item.match(/<h3[^>]*>([^<]*)<\\/h3>|<a[^>]*title=\"([^\"]*)\"/);
        const linkMatch = item.match(/<a[^>]*href=\"([^\"]*)\"/);
        const imgMatch = item.match(/<img[^>]*src=\"([^\"]*)\"/);
        
        if (titleMatch && linkMatch) {
          results.push({
            title: titleMatch[1] || titleMatch[2] || '',
            link: linkMatch[1],
            image: imgMatch ? imgMatch[1] : ''
          });
        }
      }
    }
    
    return results;
  }

  async search(opts: any): Promise<any[]> {
    const cacheKey = `search_${opts.query}`;
    
    return this.getCached(cacheKey, async () => {
      try {
        const endpoint = `/search?query=${encodeURIComponent(opts.query)}`;
        const response = await this.requestWithFallback(endpoint);
        const html = await response.text();
        
        const results: any[] = [];
        
        // 🔧 修复：使用正则表达式解析，避免cheerio依赖
        const cardRegex = /<a[^>]*class=\"[^\"]*card-mobile[^\"]*\"[\\s\\S]*?<\\/a>/g;
        let match;
        
        while ((match = cardRegex.exec(html)) !== null) {
          const card = match[0];
          const titleMatch = card.match(/<span[^>]*class=\"[^\"]*card-mobile-title[^\"]*\"[^>]*>([^<]*)<\\/span>/);
          const linkMatch = card.match(/href=\"([^\"]*)\"/);
          const imgMatch = card.match(/<img[^>]*src=\"([^\"]*)\"/);
          
          if (titleMatch && linkMatch && linkMatch[1].includes('/videos/')) {
            const link = linkMatch[1];
            const slug = link.includes('/videos/hentai/') 
              ? link.split('/videos/hentai/')[1]?.split('?')[0]?.split('/')[0]
              : link.split('/watch/')[1]?.split('?')[0]?.split('/')[0];
            
            if (slug && !results.some(r => r.id === slug)) {
              results.push({
                id: slug,
                title: titleMatch[1].trim(),
                url: this.resolveUrl(link),
                subOrDub: 'sub',
                image: imgMatch ? this.resolveUrl(imgMatch[1]) : ''
              });
            }
          }
        }

        return results.slice(0, 20);
      } catch (error) {
        console.error('Search error:', error);
        return [];
      }
    });
  }

  async findEpisodes(id: string): Promise<any[]> {
    const cacheKey = `episodes_${id}`;
    
    return this.getCached(cacheKey, async () => {
      try {
        const endpoint = `/videos/hentai/${id}`;
        const response = await this.requestWithFallback(endpoint);
        const html = await response.text();
        
        const episodes: any[] = [];
        
        // 🔧 修复：简化集数解析
        const relatedRegex = /<a[^>]*href=\"([^\"]*\/videos\/hentai\/[^\"]*)\">([^<]*)<\\/a>/g;
        let match;
        let episodeNumber = 1;
        
        while ((match = relatedRegex.exec(html)) !== null) {
          const link = match[1];
          const title = match[2];
          const epSlug = link.split('/videos/hentai/')[1]?.split('?')[0]?.split('/')[0];
          
          if (epSlug && !episodes.some(ep => ep.id === epSlug)) {
            episodes.push({
              id: epSlug,
              number: episodeNumber++,
              url: this.resolveUrl(link),
              title: title.trim() || `Episode ${episodeNumber - 1}`
            });
          }
        }

        if (episodes.length === 0) {
          episodes.push({
            id: id,
            number: 1,
            url: `${this.baseUrl}/videos/hentai/${id}`,
            title: 'Episode 1'
          });
        }

        return episodes;
      } catch (error) {
        console.error('Find episodes error:', error);
        return [{
          id: id,
          number: 1,
          url: `${this.baseUrl}/videos/hentai/${id}`,
          title: 'Episode 1'
        }];
      }
    });
  }

  async findEpisodeServer(episode: any, server: string): Promise<any> {
    const cacheKey = `server_${episode.id}_${server}`;
    
    return this.getCached(cacheKey, async () => {
      try {
        const response = await fetch(episode.url, { 
          headers: this.headers
        });
        const html = await response.text();
        
        let videoUrl = '';
        let quality = 'auto';

        // 🔧 修复：简化视频源提取，使用正则替代cheerio
        const videoPatterns = [
          /<video[^>]*><source[^>]*src=\"([^\"]*)\"/,
          /<source[^>]*src=\"([^\"]*)\"/,
          /videoUrl[^\"']*[\"']([^\"']*)[\"']/,
          /[\"']([^\"']*\.m3u8[^\"']*)[\"']/,
          /[\"']([^\"']*\.mp4[^\"']*)[\"']/
        ];

        for (const pattern of videoPatterns) {
          const match = html.match(pattern);
          if (match && match[1]) {
            videoUrl = match[1];
            break;
          }
        }

        // JSON-LD数据提取
        if (!videoUrl) {
          const jsonLdMatch = html.match(/<script type=\"application\/ld\+json\">(.*?)<\/script>/s);
          if (jsonLdMatch) {
            try {
              const data = JSON.parse(jsonLdMatch[1]);
              videoUrl = data.video?.contentUrl || data.url || '';
            } catch (e) {
              console.log('Failed to parse JSON-LD');
            }
          }
        }

        if (!videoUrl) {
          throw new Error('No video source found');
        }

        return {
          server: server || 'default',
          headers: this.headers,
          videoSources: [{
            url: this.resolveUrl(videoUrl),
            type: this.getVideoType(videoUrl),
            quality: quality
          }]
        };

      } catch (error) {
        console.error('Find episode server error:', error);
        return { 
          server: server || 'default', 
          headers: {}, 
          videoSources: [] 
        };
      }
    });
  }
}

// 🔧 修复：添加必要的导出
export default HanimeProvider;
