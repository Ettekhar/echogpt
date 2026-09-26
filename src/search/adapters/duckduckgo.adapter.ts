import { Injectable, Logger } from '@nestjs/common';
import { SearchProviderAdapter, SearchResultItem } from './search-provider.interface';

/**
 * Free DuckDuckGo search adapter. Provides live web search results without requiring
 * external API keys or subscriptions.
 */
@Injectable()
export class DuckDuckGoSearchAdapter implements SearchProviderAdapter {
  private readonly logger = new Logger(DuckDuckGoSearchAdapter.name);

  async search(query: string): Promise<SearchResultItem[]> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!res.ok) {
        throw new Error(`DuckDuckGo returned ${res.status}`);
      }

      const html = await res.text();
      const results: SearchResultItem[] = [];

      // Extract titles and URLs
      const titleRegex = /<h2 class="result__title">[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let m: RegExpExecArray | null;

      while ((m = titleRegex.exec(html)) !== null && results.length < 8) {
        let rawUrl = m[1];
        if (rawUrl.includes('uddg=')) {
          const match = rawUrl.match(/uddg=([^&]+)/);
          if (match) rawUrl = decodeURIComponent(match[1]);
        }
        const title = m[2].replace(/<[^>]+>/g, '').trim();
        results.push({ title, url: rawUrl, snippet: '' });
      }

      // Extract snippets
      const snippetRegex = /<a class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
      let idx = 0;
      while ((m = snippetRegex.exec(html)) !== null && idx < results.length) {
        results[idx].snippet = m[1].replace(/<[^>]+>/g, '').trim();
        idx++;
      }

      return results;
    } catch (err) {
      this.logger.warn(`DuckDuckGo search error: ${(err as Error).message}`);
      return [];
    }
  }
}
