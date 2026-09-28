import { Injectable, Logger } from '@nestjs/common';
import {
  ChatCompletionRequest,
  ChatCompletionResult,
  HealthCheckResult,
  ProviderAdapter,
} from './provider-adapter.interface';
import { readSseDataLines } from './sse-reader.util';

/** Anthropic Claude adapter using the Messages API. */
@Injectable()
export class ClaudeAdapter implements ProviderAdapter {
  private readonly logger = new Logger(ClaudeAdapter.name);

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const baseUrl = (request.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const conversation = request.messages.filter((m) => m.role !== 'system');

    const res = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': request.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model || 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        system: systemMessages.map((m) => m.content).join('\n') || undefined,
        messages: conversation.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (res.status === 401) {
      throw new Error('Claude authentication failed: Invalid API key');
    }
    if (res.status === 429) {
      const body = await res.text();
      throw new Error(`Claude rate limit / quota exceeded (429): ${body}`);
    }
    if (!res.ok) {
      throw new Error(`Claude request failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return {
      content: data.content?.[0]?.text ?? '',
      tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    };
  }

  async *chatStream(request: ChatCompletionRequest): AsyncGenerator<string> {
    const baseUrl = (request.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const conversation = request.messages.filter((m) => m.role !== 'system');

    const res = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': request.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model || 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        system: systemMessages.map((m) => m.content).join('\n') || undefined,
        messages: conversation.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
    });

    if (res.status === 401) {
      throw new Error('Claude authentication failed: Invalid API key');
    }
    if (res.status === 429) {
      const body = await res.text();
      throw new Error(`Claude rate limit / quota exceeded (429): ${body}`);
    }
    if (!res.ok || !res.body) {
      throw new Error(`Claude stream request failed: ${res.status} ${await res.text()}`);
    }

    for await (const payload of readSseDataLines(res)) {
      try {
        const event = JSON.parse(payload);
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          yield event.delta.text;
        }
      } catch {
        // Skip malformed/partial frames rather than aborting the whole stream.
      }
    }
  }

  async healthCheck(apiKey: string, baseUrl?: string): Promise<HealthCheckResult> {
    const base = (baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    const model = 'claude-3-5-sonnet-20241022';

    try {
      const res = await fetch(`${base}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Say "ok"' }],
        }),
      });

      if (res.status === 401) {
        return { healthy: false, error: 'Invalid API key (401 Unauthorized)' };
      }
      if (res.status === 429) {
        return { healthy: false, error: 'Rate limit or quota exceeded (429)' };
      }
      if (res.ok) {
        return { healthy: true, model };
      }
      const body = await res.text();
      return { healthy: false, error: `Request failed (${res.status}): ${body.slice(0, 200)}` };
    } catch (err: any) {
      return { healthy: false, error: `Network error: ${err.message}` };
    }
  }
}
