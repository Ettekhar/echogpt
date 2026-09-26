export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProviderAdapter {
  search(query: string): Promise<SearchResultItem[]>;
}
