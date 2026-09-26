import { Injectable } from '@nestjs/common';
import { SearchProviderAdapter, SearchResultItem } from './search-provider.interface';

/** Brave Search API. https://api.search.brave.com */
@Injectable()
export class BraveSearchAdapter implements SearchProviderAdapter {
  async search(query: string): Promise<SearchResultItem[]> {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) {
      throw new Error('BRAVE_SEARCH_API_KEY is not configured');
    }

    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!res.ok) {
      throw new Error(`Brave Search request failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const results = data.web?.results ?? [];
    return results.slice(0, 10).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.description ?? '',
    }));
  }
}
