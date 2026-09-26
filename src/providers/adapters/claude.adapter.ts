import { Injectable } from '@nestjs/common';
import {
  ChatCompletionRequest,
  ChatCompletionResult,
  ProviderAdapter,
} from './provider-adapter.interface';
import { readSseDataLines } from './sse-reader.util';

/** Anthropic Claude adapter using the Messages API. */
@Injectable()
export class ClaudeAdapter implements ProviderAdapter {
  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const baseUrl = request.baseUrl || 'https://api.anthropic.com/v1';
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
        model: request.model || 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemMessages.map((m) => m.content).join('\n') || undefined,
        messages: conversation.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

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
    const baseUrl = request.baseUrl || 'https://api.anthropic.com/v1';
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
        model: request.model || 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemMessages.map((m) => m.content).join('\n') || undefined,
        messages: conversation.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
    });

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

  async healthCheck(apiKey: string, baseUrl?: string): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl || 'https://api.anthropic.com/v1'}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      // Anthropic returns 200 for a valid key even on a trivial call; 401 means bad key.
      return res.status !== 401;
    } catch {
      return false;
    }
  }
}
