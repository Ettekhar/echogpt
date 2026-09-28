export interface ChatCompletionRequest {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
}

export interface ChatCompletionResult {
  content: string;
  tokensUsed?: number;
}

export interface HealthCheckResult {
  healthy: boolean;
  /** The model that responded successfully (only set when healthy: true). */
  model?: string;
  /** Human-readable error reason (only set when healthy: false). */
  error?: string;
}

export interface ProviderAdapter {
  /** Sends a prompt and returns the AI's reply. */
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
  /** Sends a prompt and yields incremental text chunks as they arrive (bonus: streaming). */
  chatStream(request: ChatCompletionRequest): AsyncGenerator<string>;
  /** Tests whether the API key and model are reachable. Returns a rich result. */
  healthCheck(apiKey: string, baseUrl?: string): Promise<HealthCheckResult>;
}
