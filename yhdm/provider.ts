/// <reference path="./online-streaming-provider.d.ts" />

class Provider {
  private baseUrl = "https://yhdm.one";

  getSettings(): Settings {
    return {
      episodeServers: ["默认播放器", "备用播放器"],
      supportsDub: false, // 樱花动漫主要是中文字幕，不支持配音切换
    };
  }

  async search(query: SearchOptions): Promise<SearchResult[]> {
    const normalize = (str: any) =>
      safeString(str).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ""); // 支持中文字符

    const targetNorm = normalize(query.media.romajiTitle);
    const targetNormEN = query.media.englishTitle ? normalize(query.media.englishTitle) : targetNorm;

    try {
      // 使用网站搜索功能
      const searchUrl = `${this.baseUrl}/search?q=${encodeURIComponent(query.query)}`;
      const html = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3",
        },
      }).then(res => res.text());

      const matches = this.parseSearchResults(html);
      
      if (matches.length === 0) {
        // 尝试分类页面搜索
        return await this.searchByCategory(query.query);
      }

      // 匹配最佳结果
      const levenshtein = (a: string, b: string) => {
        const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
        for (let i = 0; i <= a.length; i++) dp[i][0] = i;
        for (let j = 0; j <= b.length; j++) dp[0][j] = j;
        for (let i = 1; i <= a.length; i++) {
          for (let j = 1; j <= b.length; j++) {
            dp[i][j] =
              a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
          }
        }
        return dp[a.length][b.length];
      };

      // 寻找最佳匹配
      let best = matches.find(m => 
        normalize(m.title).includes(targetNorm) || targetNorm.includes(normalize(m.title))
      );

      if (!best && targetNormEN !== targetNorm) {
        best = matches.find(m => 
          normalize(m.title).includes(targetNormEN) || targetNormEN.includes(normalize(m.title))
        );
      }

      // 如果没有找到部分匹配，使用编辑距离
      if (!best) {
        matches.sort((a, b) => 
          levenshtein(normalize(a.title), targetNorm) - levenshtein(normalize(b.title), targetNorm)
        );
        best = matches[0];
      }

      if (!best) return [];

      return [{
        id: best.id,
        title: best.title,
        url: best.url,
        subOrDub: "sub",
      }];

    } catch (error) {
      console.error("搜索失败:", error);
      return [];
    }
  }

  private parseSearchResults(html: string): any[] {
    const results: any[] = [];
    
    // 匹配动漫链接和标题
    const linkRegex = /<a[^>]+href="\/vod\/(\d+)\.html"[^>]*>([^<]+)<\/a>/g;
    let match;
    
    while ((match = linkRegex.exec(html)) !== null) {
      const id = match[1];
      const title = match[2].trim();
      
      results.push({
        id: id,
        title: title,
        url: `${this.baseUrl}/vod/${id}.html`,
      });
    }

    // 如果上述正则没匹配到，尝试其他模式
    if (results.length === 0) {
      const altRegex = /<h3[^>]*><a[^>]+href="\/vod\/(\d+)\.html"[^>]*>([^<]+)<\/a><\/h3>/g;
      while ((match = altRegex.exec(html)) !== null) {
        const id = match[1];
        const title = match[2].trim();
        
        results.push({
          id: id,
          title: title,
          url: `${this.baseUrl}/vod/${id}.html`,
        });
      }
    }

    return results;
  }

  private async searchByCategory(query: string): Promise<SearchResult[]> {
    // 如果直接搜索失败，尝试在最新更新中查找
    try {
      const html = await fetch(`${this.baseUrl}/latest/`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }).then(res => res.text());

      const matches = this.parseSearchResults(html);
      
      // 过滤包含查询关键词的结果
      const filtered = matches.filter(m => 
        m.title.toLowerCase().includes(query.toLowerCase()) ||
        query.toLowerCase().includes(m.title.toLowerCase())
      );

      return filtered.slice(0, 5).map(m => ({
        id: m.id,
        title: m.title,
        url: m.url,
        subOrDub: "sub",
      }));
    } catch (error) {
      return [];
    }
  }

  async findEpisodes(animeId: string): Promise<EpisodeDetails[]> {
    try {
      const animeUrl = `${this.baseUrl}/vod/${animeId}.html`;
      const html = await fetch(animeUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }).then(res => res.text());

      const episodes: EpisodeDetails[] = [];
      
      // 匹配剧集链接
      const episodeRegex = /<a[^>]+href="\/vod-play\/(\d+)\/ep(\d+)\.html"[^>]*>([^<]*第(\d+)[集话][^<]*)<\/a>/g;
      let match;

      while ((match = episodeRegex.exec(html)) !== null) {
        const episodeId = match[1];
        const episodeNum = parseInt(match[2]);
        const title = match[3].trim();
        
        episodes.push({
          id: `${episodeId}/ep${episodeNum}`,
          number: episodeNum,
          title: title || `第${episodeNum}集`,
          url: `${this.baseUrl}/vod-play/${episodeId}/ep${episodeNum}.html`,
        });
      }

      // 如果上述正则没有匹配到，尝试其他模式
      if (episodes.length === 0) {
        const altRegex = /<a[^>]+href="\/vod-play\/([^"]+)"[^>]*>([^<]*)<\/a>/g;
        while ((match = altRegex.exec(html)) !== null) {
          const playPath = match[1];
          const title = match[2].trim();
          
          // 提取集数
          const epMatch = playPath.match(/ep(\d+)/);
          if (epMatch) {
            const episodeNum = parseInt(epMatch[1]);
            episodes.push({
              id: playPath,
              number: episodeNum,
              title: title || `第${episodeNum}集`,
              url: `${this.baseUrl}/vod-play/${playPath}`,
            });
          }
        }
      }

      // 按集数排序
      return episodes.sort((a, b) => a.number - b.number);

    } catch (error) {
      console.error("获取剧集列表失败:", error);
      return [];
    }
  }

  async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
    try {
      // 获取播放页面
      const html = await fetch(episode.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": this.baseUrl,
        },
      }).then(res => res.text());

      // 提取视频播放地址
      const videoUrl = await this.extractVideoUrl(html, episode.url);
      
      if (!videoUrl) {
        throw new Error("无法提取视频播放地址");
      }

      return {
        server: server,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": episode.url,
          "Accept": "*/*",
        },
        videoSources: [{
          url: videoUrl,
          type: this.getVideoType(videoUrl),
          quality: "auto",
          subtitles: [], // 樱花动漫通常是硬字幕
        }],
      };

    } catch (error) {
      console.error("获取播放地址失败:", error);
      throw new Error(`无法获取 ${server} 的播放地址`);
    }
  }

  private async extractVideoUrl(html: string, pageUrl: string): Promise<string | null> {
    // 方法1: 查找直接的视频链接
    let videoMatch = html.match(/(?:src|source)=["']([^"']+\.(?:mp4|m3u8|flv))[^"']*/i);
    if (videoMatch) {
      return this.resolveUrl(videoMatch[1], pageUrl);
    }

    // 方法2: 查找 iframe 嵌入
    const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/i);
    if (iframeMatch) {
      const iframeUrl = this.resolveUrl(iframeMatch[1], pageUrl);
      try {
        const iframeHtml = await fetch(iframeUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": pageUrl,
          },
        }).then(res => res.text());

        // 在 iframe 中查找视频源
        videoMatch = iframeHtml.match(/(?:src|source|file)=["']([^"']+\.(?:mp4|m3u8|flv))[^"']*/i);
        if (videoMatch) {
          return this.resolveUrl(videoMatch[1], iframeUrl);
        }
      } catch (error) {
        console.warn("无法加载 iframe 内容:", error);
      }
    }

    // 方法3: 查找 JavaScript 中的播放地址
    const jsMatch = html.match(/(?:url|src|source|file)["']?\s*:\s*["']([^"']+\.(?:mp4|m3u8|flv))[^"']*/i);
    if (jsMatch) {
      return this.resolveUrl(jsMatch[1], pageUrl);
    }

    // 方法4: 查找常见的播放器配置
    const configMatch = html.match(/config\s*=\s*{[^}]*(?:url|src|source|file)["']?\s*:\s*["']([^"']+)[^"']*/i);
    if (configMatch) {
      return this.resolveUrl(configMatch[1], pageUrl);
    }

    return null;
  }

  private resolveUrl(url: string, baseUrl: string): string {
    if (url.startsWith("http")) {
      return url;
    }
    if (url.startsWith("//")) {
      return "https:" + url;
    }
    if (url.startsWith("/")) {
      const base = new URL(baseUrl);
      return `${base.protocol}//${base.host}${url}`;
    }
    return new URL(url, baseUrl).href;
  }

  private getVideoType(url: string): string {
    if (url.includes(".m3u8") || url.includes("m3u8")) {
      return "m3u8";
    }
    if (url.includes(".mp4")) {
      return "mp4";
    }
    if (url.includes(".flv")) {
      return "flv";
    }
    return "mp4"; // 默认
  }
}

const safeString = (str: any) => (typeof str === "string" ? str : "");

function normalizeSeasonParts(title: string) {
  const s = safeString(title);
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "") // 保留中文字符
    .replace(/第.*?季/g, "") // 移除 "第X季"
    .replace(/第.*?部/g, "") // 移除 "第X部"
    .replace(/season|cour|part/g, ""); // 移除英文季数标识
}
