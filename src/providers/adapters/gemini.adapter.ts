import { Injectable } from '@nestjs/common';
import {
  ChatCompletionRequest,
  ChatCompletionResult,
  ProviderAdapter,
} from './provider-adapter.interface';
import { readSseDataLines } from './sse-reader.util';

/** Google Gemini adapter using the generateContent REST endpoint. */
@Injectable()
export class GeminiAdapter implements ProviderAdapter {
  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const baseUrl = request.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const model = request.model || 'gemini-1.5-flash';
    const url = `${baseUrl}/models/${model}:generateContent?key=${request.apiKey}`;

    const contents = this.toGeminiContents(request);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents }),
    });

    if (!res.ok) {
      throw new Error(`Gemini request failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
      tokensUsed: data.usageMetadata?.totalTokenCount,
    };
  }

  async *chatStream(request: ChatCompletionRequest): AsyncGenerator<string> {
    const baseUrl = request.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const model = request.model || 'gemini-1.5-flash';
    // alt=sse asks the Gemini REST API to emit Server-Sent-Events frames instead of one JSON array.
    const url = `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${request.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: this.toGeminiContents(request) }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Gemini stream request failed: ${res.status} ${await res.text()}`);
    }

    for await (const payload of readSseDataLines(res)) {
      try {
        const event = JSON.parse(payload);
        const text = event.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) yield text;
      } catch {
        // Skip malformed/partial frames rather than aborting the whole stream.
      }
    }
  }

  async healthCheck(apiKey: string, baseUrl?: string): Promise<boolean> {
    try {
      const url = `${baseUrl || 'https://generativelanguage.googleapis.com/v1beta'}/models?key=${apiKey}`;
      const res = await fetch(url);
      return res.ok;
    } catch {
      return false;
    }
  }

  private toGeminiContents(request: ChatCompletionRequest) {
    return request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
  }
}
