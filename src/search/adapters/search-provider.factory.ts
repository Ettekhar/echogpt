import { Injectable, Logger } from '@nestjs/common';
import { SearchProviderAdapter } from './search-provider.interface';
import { SerperSearchAdapter } from './serper.adapter';
import { BraveSearchAdapter } from './brave.adapter';

/**
 * Picks the active search backend from SEARCH_PROVIDER ("serper" | "brave"). Defaults to
 * "serper". If neither provider's API key is configured, getActive() returns null and
 * SearchService falls back to a clear "not configured" response instead of throwing.
 */
@Injectable()
export class SearchProviderFactory {
  private readonly logger = new Logger(SearchProviderFactory.name);

  constructor(
    private serper: SerperSearchAdapter,
    private brave: BraveSearchAdapter,
  ) {}

  getActive(): SearchProviderAdapter | null {
    const provider = (process.env.SEARCH_PROVIDER || 'serper').toLowerCase();

    if (provider === 'brave') {
      if (!process.env.BRAVE_SEARCH_API_KEY) return null;
      return this.brave;
    }
    // default: serper
    if (!process.env.SERPER_API_KEY) return null;
    return this.serper;
  }
}
