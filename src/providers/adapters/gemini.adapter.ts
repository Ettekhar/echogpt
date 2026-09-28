import { Injectable, Logger } from '@nestjs/common';
import {
  ChatCompletionRequest,
  ChatCompletionResult,
  ProviderAdapter,
} from './provider-adapter.interface';
import { readSseDataLines } from './sse-reader.util';

/**
 * Stable, GA Gemini models in priority order.
 * We cascade through fallbacks when a model returns 503 (overloaded) so the
 * user always gets a real AI response even during demand spikes.
 */
const STABLE_GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

const DEFAULT_GEMINI_MODEL =
  process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.0-flash';

/** Google Gemini adapter using the generateContent REST endpoint. */
@Injectable()
export class GeminiAdapter implements ProviderAdapter {
  private readonly logger = new Logger(GeminiAdapter.name);

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const baseUrl = this.resolveBaseUrl(request.baseUrl);
    const primaryModel = this.resolveModel(request.model);
    const contents = this.toGeminiContents(request);

    // Build cascade: primary model first, then stable fallbacks (excluding primary if it's already in the list)
    const modelCascade = [
      primaryModel,
      ...STABLE_GEMINI_MODELS.filter((m) => m !== primaryModel),
    ];

    let lastError: Error | undefined;

    for (const model of modelCascade) {
      try {
        const res = await this.fetchWithRetry(() =>
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

        if (res.status === 401 || res.status === 403) {
          const body = await res.text();
          throw new Error(`Gemini authentication failed (${res.status}): ${body}`);
        }

        if (res.status === 429) {
          const body = await res.text();
          throw new Error(`Gemini rate limit exceeded (429): ${body}`);
        }

        if (res.status === 503) {
          const body = await res.text();
          this.logger.warn(`Gemini model "${model}" still overloaded (503), trying next model...`);
          lastError = new Error(`Gemini model "${model}" overloaded (503): ${body}`);
          continue; // try next model
        }

        if (!res.ok) {
          const body = await res.text();
          lastError = new Error(`Gemini request failed (${res.status}): ${body}`);
          // 404 on a specific model → try next
          if (res.status === 404) continue;
          throw lastError;
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text && data.promptFeedback?.blockReason) {
          throw new Error(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`);
        }

        if (model !== primaryModel) {
          this.logger.log(`Gemini chat succeeded using fallback model "${model}" (primary "${primaryModel}" was unavailable).`);
        }

        return {
          content: text ?? '',
          tokensUsed: data.usageMetadata?.totalTokenCount,
        };
      } catch (err: any) {
        // Re-throw immediately for auth/rate-limit/content-policy errors — no point retrying with another model
        if (err.message?.includes('authentication failed') ||
            err.message?.includes('rate limit') ||
            err.message?.includes('blocked the prompt')) {
          throw err;
        }
        lastError = err;
        this.logger.warn(`Gemini model "${model}" failed: ${err.message}. Trying next model in cascade...`);
      }
    }

    throw lastError ?? new Error('All Gemini models unavailable');
  }

  async *chatStream(request: ChatCompletionRequest): AsyncGenerator<string> {
    const baseUrl = this.resolveBaseUrl(request.baseUrl);
    const primaryModel = this.resolveModel(request.model);
    const contents = this.toGeminiContents(request);

    const modelCascade = [
      primaryModel,
      ...STABLE_GEMINI_MODELS.filter((m) => m !== primaryModel),
    ];

    let lastError: Error | undefined;

    for (const model of modelCascade) {
      try {
        const res = await this.fetchWithRetry(() =>
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

        if (res.status === 401 || res.status === 403) {
          const body = await res.text();
          throw new Error(`Gemini authentication failed (${res.status}): ${body}`);
        }

        if (res.status === 429) {
          const body = await res.text();
          throw new Error(`Gemini rate limit exceeded (429): ${body}`);
        }

        if (res.status === 503) {
          this.logger.warn(`Gemini stream model "${model}" overloaded (503), trying next model...`);
          lastError = new Error(`Gemini stream model "${model}" overloaded (503)`);
          continue;
        }

        if (!res.ok || !res.body) {
          const body = await res.text();
          lastError = new Error(`Gemini stream request failed (${res.status}): ${body}`);
          if (res.status === 404) continue;
          throw lastError;
        }

        if (model !== primaryModel) {
          this.logger.log(`Gemini stream succeeded using fallback model "${model}".`);
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
        return; // successfully streamed
      } catch (err: any) {
        if (err.message?.includes('authentication failed') ||
            err.message?.includes('rate limit') ||
            err.message?.includes('blocked the prompt')) {
          throw err;
        }
        lastError = err;
        this.logger.warn(`Gemini stream model "${model}" failed: ${err.message}. Trying next...`);
      }
    }

    throw lastError ?? new Error('All Gemini stream models unavailable');
  }

  async healthCheck(apiKey: string, baseUrl?: string): Promise<{ healthy: boolean; model?: string; error?: string }> {
    const base = this.resolveBaseUrl(baseUrl);

    // Per Gemini API documentation (https://ai.google.dev/gemini-api/docs/api-key):
    //   400 INVALID_ARGUMENT / API_KEY_INVALID = invalid or malformed API key
    //   403 PERMISSION_DENIED                  = missing or empty API key
    //   503 UNAVAILABLE                        = model overloaded (key may still be valid)
    try {
      const listRes = await fetch(`${base}/models`, {
        headers: { 'x-goog-api-key': apiKey },
      });

      if (listRes.status === 400) {
        const body = await listRes.json().catch(() => ({} as any));
        const reason: string = body?.error?.details?.[0]?.reason ?? body?.error?.status ?? '';
        if (reason === 'API_KEY_INVALID' || body?.error?.status === 'INVALID_ARGUMENT') {
          return { healthy: false, error: 'Invalid API key (400 INVALID_ARGUMENT). Check your Gemini API key at https://aistudio.google.com/app/apikey' };
        }
        return { healthy: false, error: `Request failed (400): ${body?.error?.message ?? 'Unknown error'}` };
      }

      if (listRes.status === 403) {
        return { healthy: false, error: 'API key missing or permission denied (403 PERMISSION_DENIED).' };
      }

      if (listRes.status === 401) {
        return { healthy: false, error: 'Invalid API key (401 Unauthorized).' };
      }

      if (!listRes.ok && listRes.status !== 503) {
        const body = await listRes.text();
        return { healthy: false, error: `Models list failed (${listRes.status}): ${body.slice(0, 200)}` };
      }
    } catch (err: any) {
      return { healthy: false, error: `Network error: ${err.message}` };
    }

    // Step 2: Try a real minimal generation with the most stable model
    for (const model of STABLE_GEMINI_MODELS) {
      try {
        const res = await fetch(`${base}/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Say "ok"' }] }],
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return { healthy: true, model };
        }

        // Check for invalid key on the generation endpoint too
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          const body = await res.json().catch(() => ({} as any));
          return { healthy: false, error: `API key rejected (${res.status}): ${body?.error?.message ?? 'Invalid API key'}` };
        }

        if (res.status === 429) {
          return { healthy: false, error: 'Quota/rate-limit exceeded (429). Key is valid but no remaining credits.' };
        }

        if (res.status === 503) continue; // overloaded, try next model
      } catch {
        continue;
      }
    }

    return { healthy: false, error: 'All stable Gemini models are currently unavailable (503). API key may be valid but quota exceeded.' };
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
   */
  private resolveModel(requestedModel?: string): string {
    if (!requestedModel || !requestedModel.trim()) return DEFAULT_GEMINI_MODEL;
    const m = requestedModel
      .trim()
      .toLowerCase()
      .replace(/^models\//, '')
      .replace(/\s+/g, '-');
    return m;
  }

  /**
   * Single 503 retry with 800ms delay + 404-on-flaky-backing-build retry.
   */
  private async fetchWithRetry(
    doFetch: () => Promise<Response>,
    model: string,
  ): Promise<Response> {
    let res = await doFetch();

    // One immediate retry on 503
    if (res.status === 503) {
      this.logger.warn(`Gemini model "${model}" returned 503, retrying once after 800ms...`);
      await new Promise((r) => setTimeout(r, 800));
      res = await doFetch();
    }

    // One retry on flaky internal-build 404
    if (res.status === 404) {
      const bodyText = await res.clone().text();
      if (/Model not found: models\//i.test(bodyText)) {
        this.logger.warn(`Gemini model "${model}" 404'd on internal backing build, retrying: ${bodyText}`);
        res = await doFetch();
      }
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