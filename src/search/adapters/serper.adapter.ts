import { Injectable } from '@nestjs/common';
import { SearchProviderAdapter, SearchResultItem } from './search-provider.interface';

/** Serper.dev - a thin wrapper around Google Search results. https://serper.dev */
@Injectable()
export class SerperSearchAdapter implements SearchProviderAdapter {
  async search(query: string): Promise<SearchResultItem[]> {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      throw new Error('SERPER_API_KEY is not configured');
    }

    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query }),
    });

    if (!res.ok) {
      throw new Error(`Serper request failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const organic = Array.isArray(data.organic) ? data.organic : [];
    return organic.slice(0, 10).map((r: any) => ({
      title: r.title ?? '',
      url: r.link ?? '',
      snippet: r.snippet ?? '',
    }));
  }
}
