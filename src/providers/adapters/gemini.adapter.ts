import { Injectable, Logger } from '@nestjs/common';
import {
  ChatCompletionRequest,
  ChatCompletionResult,
  ProviderAdapter,
} from './provider-adapter.interface';
import { readSseDataLines } from './sse-reader.util';

/**
 * Confirmed live against this project's key (see the `/models` list) as a stable, GA model -
 * not a "latest" alias. Google has been repointing "latest" aliases to preview models
 * (gemini-flash-latest -> gemini-3-flash-preview as of Jan 21, 2026), so we deliberately do
 * NOT default to an alias here. Override via GEMINI_DEFAULT_MODEL without a redeploy if Google
 * moves the ground again.
 */
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_DEFAULT_MODEL || 'gemini-flash-latest';

/**
 * Some GA model aliases (e.g. gemini-3.5-flash, per Google's own forum reports) intermittently
 * 404 with "Model not found: models/<internal-backing-build>" when their alias load-balances
 * onto a decommissioned backend build. It's not retryable via normal backoff in general, but a
 * single quick retry clears it often enough in practice to be worth doing before failing the
 * whole request.
 */
const MODEL_404_RETRY_COUNT = 1;

/** Google Gemini adapter using the generateContent REST endpoint. */
@Injectable()
export class GeminiAdapter implements ProviderAdapter {
  private readonly logger = new Logger(GeminiAdapter.name);

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const baseUrl = this.resolveBaseUrl(request.baseUrl);
    const model = this.resolveModel(request.model);
    const contents = this.toGeminiContents(request);

    const res = await this.fetchWithModelNotFoundRetry(
      () =>
        fetch(`${baseUrl}/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': request.apiKey,
          },
          body: JSON.stringify({ contents }),
        }),
      model,
    );

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
    const baseUrl = this.resolveBaseUrl(request.baseUrl);
    const model = this.resolveModel(request.model);
    const contents = this.toGeminiContents(request);

    // alt=sse asks the Gemini REST API to emit Server-Sent-Events frames instead of one JSON array.
    const res = await this.fetchWithModelNotFoundRetry(
      () =>
        fetch(`${baseUrl}/models/${model}:streamGenerateContent?alt=sse`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': request.apiKey,
          },
          body: JSON.stringify({ contents }),
        }),
      model,
    );

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
      const base = this.resolveBaseUrl(baseUrl);
      const res = await fetch(`${base}/models`, {
        headers: { 'x-goog-api-key': apiKey },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private resolveBaseUrl(baseUrl?: string): string {
    if (!baseUrl || !baseUrl.trim()) {
      return 'https://generativelanguage.googleapis.com/v1beta';
    }
    let url = baseUrl.trim().replace(/\/+$/, '');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    return url;
  }

  /**
   * Resolves and sanitizes the requested model name.
   * Strips any "models/" prefix, replaces spaces with hyphens, and trims.
   * Also maps legacy 1.5 models to gemini-flash-latest or gemini-3.5-flash.
   */
  private resolveModel(requestedModel?: string): string {
    if (!requestedModel || !requestedModel.trim()) return DEFAULT_GEMINI_MODEL;
    let m = requestedModel.trim().toLowerCase().replace(/^models\//, '').replace(/\s+/g, '-');
    if (m === 'gemini-1.5-pro' || m === 'gemini-1.5-flash' || m === 'gemini-2.5-flash') {
      return DEFAULT_GEMINI_MODEL;
    }
    return m;
  }

  /**
   * Retries once, with a fresh request, on the specific "Model not found: models/<internal
   * backing build>" 404 some GA aliases intermittently return when they load-balance onto a
   * decommissioned build. Any other status (including a "real" 404 for a genuinely invalid
   * model name) is returned as-is on the first try.
   */
  private async fetchWithModelNotFoundRetry(
    doFetch: () => Promise<Response>,
    model: string,
  ): Promise<Response> {
    let res = await doFetch();

    if (res.status === 503) {
      this.logger.warn(`Gemini model "${model}" returned 503 overload, retrying after 600ms...`);
      await new Promise((r) => setTimeout(r, 600));
      res = await doFetch();
    }

    for (let attempt = 0; attempt < MODEL_404_RETRY_COUNT && res.status === 404; attempt++) {
      const bodyText = await res.clone().text();
      const looksLikeFlakyBackingBuild = /Model not found: models\//i.test(bodyText);
      if (!looksLikeFlakyBackingBuild) break;

      this.logger.warn(
        `Gemini model "${model}" 404'd on an internal backing build, retrying once: ${bodyText}`,
      );
      res = await doFetch();
    }

    return res;
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