import { Injectable, Logger } from '@nestjs/common';
import {
  ChatCompletionRequest,
  ChatCompletionResult,
  ProviderAdapter,
} from './provider-adapter.interface';
import { readSseDataLines } from './sse-reader.util';

/**
 * OpenAI adapter. Talks to the Chat Completions endpoint directly over fetch
 * so the project has no hard dependency on the `openai` SDK version.
 */
@Injectable()
export class OpenAiAdapter implements ProviderAdapter {
  private readonly logger = new Logger(OpenAiAdapter.name);

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const baseUrl = (request.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = request.model || 'gpt-4o-mini';

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
      }),
    });

    if (res.status === 401) {
      throw new Error(`OpenAI authentication failed: Invalid API key`);
    }
    if (res.status === 429) {
      const body = await res.text();
      throw new Error(`OpenAI rate limit / quota exceeded (429): ${body}`);
    }
    if (!res.ok) {
      throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return {
      content: data.choices?.[0]?.message?.content ?? '',
      tokensUsed: data.usage?.total_tokens,
    };
  }

  async *chatStream(request: ChatCompletionRequest): AsyncGenerator<string> {
    const baseUrl = (request.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = request.model || 'gpt-4o-mini';

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        stream: true,
      }),
    });

    if (res.status === 401) {
      throw new Error(`OpenAI authentication failed: Invalid API key`);
    }
    if (res.status === 429) {
      const body = await res.text();
      throw new Error(`OpenAI rate limit / quota exceeded (429): ${body}`);
    }
    if (!res.ok || !res.body) {
      throw new Error(`OpenAI stream request failed: ${res.status} ${await res.text()}`);
    }

    for await (const payload of readSseDataLines(res)) {
      try {
        const event = JSON.parse(payload);
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // Skip malformed/partial frames rather than aborting the whole stream.
      }
    }
  }

  async healthCheck(apiKey: string, baseUrl?: string): Promise<{ healthy: boolean; model?: string; error?: string }> {
    const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');

    // Step 1: Validate key via models list (lightweight)
    try {
      const listRes = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (listRes.status === 401) {
        return { healthy: false, error: 'Invalid API key (401 Unauthorized)' };
      }
      if (listRes.status === 429) {
        return { healthy: false, error: 'Rate limit or quota exceeded (429)' };
      }
      if (!listRes.ok) {
        return { healthy: false, error: `Models list failed: ${listRes.status}` };
      }
    } catch (err: any) {
      return { healthy: false, error: `Network error: ${err.message}` };
    }

    // Step 2: Real minimal generation test
    try {
      const model = 'gpt-4o-mini'; // cheapest/most available model
      const genRes = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say "ok"' }],
          max_tokens: 5,
        }),
      });

      if (genRes.ok) {
        return { healthy: true, model };
      }
      if (genRes.status === 401) {
        return { healthy: false, error: 'Invalid API key (401)' };
      }
      if (genRes.status === 429) {
        return { healthy: false, error: 'Quota/rate-limit exceeded (429). Key is valid but no credits.' };
      }
      const body = await genRes.text();
      return { healthy: false, error: `Generation test failed (${genRes.status}): ${body.slice(0, 200)}` };
    } catch (err: any) {
      return { healthy: false, error: `Generation test network error: ${err.message}` };
    }
  }
}
