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

export interface ProviderAdapter {
  /** Sends a prompt and returns the AI's reply. */
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
  /** Sends a prompt and yields incremental text chunks as they arrive (bonus: streaming). */
  chatStream(request: ChatCompletionRequest): AsyncGenerator<string>;
  /** Lightweight call used by the provider Health Check endpoint. */
  healthCheck(apiKey: string, baseUrl?: string): Promise<boolean>;
}
