/// <reference path="./online-streaming-provider.d.ts" />
/// <reference path="./core.d.ts" />

import axios from 'axios';
import cheerio from 'cheerio';

class HanimeProvider extends AnimeProvider {
  private baseUrl = 'https://hanime1.me';
  private fallbackUrls = ['https://hanime.tv', 'https://hanime1.tv'];
  private headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': this.baseUrl,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
  };
  
  // 内存缓存
  private cache = new Map<string, any>();
  private cacheTimeout = 5 * 60 * 1000; // 5分钟缓存

  getSettings(): Settings {
    return {
      episodeServers: ['default', 'backup'],
      supportsDub: false
    };
  }

  // 缓存辅助方法
  private async getCached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    
    const data = await fetcher();
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }

  // URL解析辅助方法
  private resolveUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return this.baseUrl + url;
    return this.baseUrl + '/' + url;
  }

  // 视频类型检测
  private getVideoType(url: string): string {
    if (url.includes('.m3u8') || url.includes('m3u8')) return 'm3u8';
    if (url.includes('.mp4')) return 'mp4';
    if (url.includes('.mkv')) return 'mkv';
    return 'auto';
  }

  // 域名回退机制
  private async requestWithFallback(endpoint: string): Promise<any> {
    const urls = [this.baseUrl, ...this.fallbackUrls];
    
    for (const url of urls) {
      try {
        const response = await axios.get(`${url}${endpoint}`, { 
          headers: { ...this.headers, 'Referer': url },
          timeout: 10000
        });
        if (response.status === 200) {
          this.baseUrl = url; // 更新工作的URL
          return response;
        }
      } catch (error) {
        console.log(`Failed to connect to ${url}, trying next...`);
        continue;
      }
    }
    throw new Error('All domains failed');
  }

  async search(opts: SearchOptions): Promise<SearchResult[]> {
    const cacheKey = `search_${opts.query}`;
    
    return this.getCached(cacheKey, async () => {
      try {
        const endpoint = `/search?query=${encodeURIComponent(opts.query)}`;
        const response = await this.requestWithFallback(endpoint);
        const $ = cheerio.load(response.data);
        const results: SearchResult[] = [];

        // 多种选择器确保兼容性
        const selectors = [
          '.row .col a.card-mobile',
          '.search-results .item a',
          '.video-grid .video-item a',
          '[data-video-id] a'
        ];

        for (const selector of selectors) {
          $(selector).each((i, el) => {
            const link = $(el).attr('href');
            if (link && (link.includes('/videos/hentai/') || link.includes('/watch/'))) {
              // 提取ID的多种方式
              let slug = '';
              if (link.includes('/videos/hentai/')) {
                slug = link.split('/videos/hentai/')[1]?.split('?')[0]?.split('/')[0] || '';
              } else if (link.includes('/watch/')) {
                slug = link.split('/watch/')[1]?.split('?')[0]?.split('/')[0] || '';
              }

              if (!slug) return;

              // 提取标题的多种方式
              const titleSelectors = [
                '.card-mobile-title span',
                '.video-title',
                '.title',
                'h3',
                'h4'
              ];
              
              let title = '';
              for (const titleSel of titleSelectors) {
                title = $(el).find(titleSel).text().trim();
                if (title) break;
              }

              // 提取封面图
              const coverSelectors = ['img', '.thumbnail img', '.cover img'];
              let cover = '';
              for (const coverSel of coverSelectors) {
                cover = $(el).find(coverSel).attr('src') || $(el).find(coverSel).attr('data-src') || '';
                if (cover) {
                  cover = this.resolveUrl(cover);
                  break;
                }
              }

              // 避免重复添加
              if (!results.some(r => r.id === slug)) {
                results.push({
                  id: slug,
                  title: title || slug.replace(/-/g, ' '),
                  url: this.resolveUrl(link),
                  subOrDub: 'sub',
                  image: cover
                });
              }
            }
          });
          
          if (results.length > 0) break; // 找到结果就停止尝试其他选择器
        }

        return results.slice(0, 20); // 限制结果数量
      } catch (error) {
        console.error('[HanimeProvider] Search error:', {
          error: error.message,
          query: opts.query,
          timestamp: new Date().toISOString()
        });
        return [];
      }
    });
  }

  async findEpisodes(id: string): Promise<EpisodeDetails[]> {
    const cacheKey = `episodes_${id}`;
    
    return this.getCached(cacheKey, async () => {
      try {
        const endpoint = `/videos/hentai/${id}`;
        const response = await this.requestWithFallback(endpoint);
        const $ = cheerio.load(response.data);
        const episodes: EpisodeDetails[] = [];

        // 查找相关剧集的多种方式
        const relatedSelectors = [
          '#related-videos .row .col a',
          '.related-videos a',
          '.episode-list a',
          '.series-episodes a'
        ];

        let episodeNumber = 1;
        let foundRelated = false;

        for (const selector of relatedSelectors) {
          $(selector).each((i, el) => {
            const link = $(el).attr('href');
            if (link && (link.includes('/videos/hentai/') || link.includes('/watch/'))) {
              let epSlug = '';
              if (link.includes('/videos/hentai/')) {
                epSlug = link.split('/videos/hentai/')[1]?.split('?')[0]?.split('/')[0] || '';
              } else if (link.includes('/watch/')) {
                epSlug = link.split('/watch/')[1]?.split('?')[0]?.split('/')[0] || '';
              }

              if (!epSlug || episodes.some(ep => ep.id === epSlug)) return;

              const titleSelectors = ['.card-mobile-title span', '.episode-title', '.title'];
              let epTitle = '';
              for (const titleSel of titleSelectors) {
                epTitle = $(el).find(titleSel).text().trim();
                if (epTitle) break;
              }

              episodes.push({
                id: epSlug,
                number: episodeNumber++,
                url: this.resolveUrl(link),
                title: epTitle || `Episode ${episodeNumber - 1}`
              });
              foundRelated = true;
            }
          });
          
          if (foundRelated) break;
        }

        // 如果没找到相关剧集，默认单集
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
        console.error('[HanimeProvider] Find episodes error:', {
          error: error.message,
          id: id,
          timestamp: new Date().toISOString()
        });
        return [{
          id: id,
          number: 1,
          url: `${this.baseUrl}/videos/hentai/${id}`,
          title: 'Episode 1'
        }];
      }
    });
  }

  async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
    const cacheKey = `server_${episode.id}_${server}`;
    
    return this.getCached(cacheKey, async () => {
      try {
        const response = await axios.get(episode.url, { 
          headers: this.headers,
          timeout: 15000
        });
        const $ = cheerio.load(response.data);
        let videoUrl = '';
        let quality = 'auto';

        // 方法1: 从video/source标签直接获取
        const videoElement = $('video source[type*="mpegurl"], video source[src*="m3u8"], video source').first();
        videoUrl = videoElement.attr('src') || '';

        // 方法2: 从script标签中的JSON配置
        if (!videoUrl) {
          const scripts = $('script').get();
          for (const script of scripts) {
            const content = $(script).html() || '';
            
            // 匹配各种可能的视频URL格式
            const patterns = [
              /["']([^"']*\.m3u8[^"']*)["']/g,
              /videoUrl["\s]*:["\s]*["']([^"']+)["']/g,
              /src["\s]*:["\s]*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/g,
              /file["\s]*:["\s]*["']([^"']+)["']/g
            ];

            for (const pattern of patterns) {
              const matches = [...content.matchAll(pattern)];
              if (matches.length > 0) {
                videoUrl = matches[0][1];
                break;
              }
            }
            
            if (videoUrl) break;
          }
        }

        // 方法3: 从JSON-LD结构化数据
        if (!videoUrl) {
          const jsonLD = $('script[type="application/ld+json"]').html();
          if (jsonLD) {
            try {
              const data = JSON.parse(jsonLD);
              if (data.video?.contentUrl) {
                videoUrl = data.video.contentUrl;
              } else if (data.url) {
                videoUrl = data.url;
              }
            } catch (e) {
              console.log('Failed to parse JSON-LD');
            }
          }
        }

        // 方法4: 尝试API调用
        if (!videoUrl) {
          try {
            const apiEndpoints = [
              `/api/video/${episode.id}`,
              `/api/v1/videos/${episode.id}`,
              `/video/${episode.id}/sources`
            ];

            for (const apiEndpoint of apiEndpoints) {
              try {
                const apiResponse = await axios.get(`${this.baseUrl}${apiEndpoint}`, { 
                  headers: this.headers,
                  timeout: 5000
                });
                const data = apiResponse.data;
                videoUrl = data?.videoUrl || data?.src || data?.url || data?.source || '';
                if (data?.quality) quality = data.quality;
                if (videoUrl) break;
              } catch (apiError) {
                continue;
              }
            }
          } catch (e) {
            console.log('API methods failed');
          }
        }

        // 解析视频质量信息
        if (videoUrl && videoUrl.includes('720')) quality = '720p';
        else if (videoUrl && videoUrl.includes('1080')) quality = '1080p';
        else if (videoUrl && videoUrl.includes('480')) quality = '480p';

        // 查找字幕
        const subtitles: any[] = [];
        $('track[kind="subtitles"], .subtitle-track').each((i, el) => {
          const subSrc = $(el).attr('src');
          const subLang = $(el).attr('srclang') || $(el).attr('data-lang') || 'en';
          if (subSrc) {
            subtitles.push({
              url: this.resolveUrl(subSrc),
              language: subLang,
              label: $(el).attr('label') || subLang.toUpperCase()
            });
          }
        });

        if (!videoUrl) {
          throw new Error('No video source found');
        }

        return {
          server: server || 'default',
          headers: this.headers,
          videoSources: [{
            url: this.resolveUrl(videoUrl),
            type: this.getVideoType(videoUrl),
            quality: quality,
            subtitles: subtitles
          }]
        };

      } catch (error) {
        console.error('[HanimeProvider] Find episode server error:', {
          error: error.message,
          episodeId: episode.id,
          episodeUrl: episode.url,
          server: server,
          timestamp: new Date().toISOString()
        });

        // 返回空的服务器信息而不是抛出错误
        return { 
          server: server || 'default', 
          headers: {}, 
          videoSources: [] 
        };
      }
    });
  }

  // URL解析辅助方法
  private resolveUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return this.baseUrl + url;
    return this.baseUrl + '/' + url;
  }

  // 视频类型检测
  private getVideoType(url: string): string {
    if (url.includes('.m3u8') || url.includes('m3u8')) return 'm3u8';
    if (url.includes('.mp4')) return 'mp4';
    if (url.includes('.mkv')) return 'mkv';
    if (url.includes('.webm')) return 'webm';
    return 'auto';
  }

  // 清理缓存（可选，防止内存泄漏）
  public clearCache(): void {
    this.cache.clear();
  }

  // 获取提供商信息
  public getProviderInfo(): any {
    return {
      name: 'Hanime1.me Provider',
      version: '1.1.0',
      baseUrl: this.baseUrl,
      cacheSize: this.cache.size,
      supportedFormats: ['m3u8', 'mp4', 'mkv', 'webm']
    };
  }
}