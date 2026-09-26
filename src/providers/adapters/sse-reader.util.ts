/**
 * Reads a fetch() Response whose body is a Server-Sent-Events stream and yields each
 * raw "data: ..." payload (with the "data: " prefix stripped) as it arrives. Shared by
 * the OpenAI/Claude/Gemini streaming adapters so each one only has to know its own
 * event JSON shape, not how to buffer/split SSE frames.
 */
export async function* readSseDataLines(response: Response): AsyncGenerator<string> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        if (payload) yield payload;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
