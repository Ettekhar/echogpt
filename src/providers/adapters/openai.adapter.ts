import { Injectable } from '@nestjs/common';
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
  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const baseUrl = request.baseUrl || 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || 'gpt-4o-mini',
        messages: request.messages,
      }),
    });

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
    const baseUrl = request.baseUrl || 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || 'gpt-4o-mini',
        messages: request.messages,
        stream: true,
      }),
    });

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

  async healthCheck(apiKey: string, baseUrl?: string): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl || 'https://api.openai.com/v1'}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
