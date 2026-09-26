import { Injectable, Logger } from '@nestjs/common';
import { SearchProviderAdapter } from './search-provider.interface';
import { SerperSearchAdapter } from './serper.adapter';
import { BraveSearchAdapter } from './brave.adapter';
import { DuckDuckGoSearchAdapter } from './duckduckgo.adapter';

/**
 * Picks the active search backend from SEARCH_PROVIDER ("serper" | "brave"). Defaults to
 * "serper" if key exists, then "brave" if key exists, and falls back to DuckDuckGo search
 * so searches always provide results even without commercial API keys.
 */
@Injectable()
export class SearchProviderFactory {
  private readonly logger = new Logger(SearchProviderFactory.name);

  constructor(
    private serper: SerperSearchAdapter,
    private brave: BraveSearchAdapter,
    private duckduckgo: DuckDuckGoSearchAdapter,
  ) {}

  getActive(): SearchProviderAdapter {
    const provider = (process.env.SEARCH_PROVIDER || '').toLowerCase();

    if (provider === 'brave' && process.env.BRAVE_SEARCH_API_KEY) {
      return this.brave;
    }
    if (provider === 'serper' && process.env.SERPER_API_KEY) {
      return this.serper;
    }
    if (process.env.SERPER_API_KEY) {
      return this.serper;
    }
    if (process.env.BRAVE_SEARCH_API_KEY) {
      return this.brave;
    }

    return this.duckduckgo;
  }
}
