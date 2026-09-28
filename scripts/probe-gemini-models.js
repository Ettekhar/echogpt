/* eslint-disable */
// Temporary probe: check which Gemini models actually accept generateContent right now.
const KEY = process.env.GEMINI_KEY;
const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
];

(async () => {
  for (const m of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Say ok' }] }] }),
      });
      if (res.ok) {
        const d = await res.json();
        console.log(`${m.padEnd(26)} 200  -> ${JSON.stringify(d?.candidates?.[0]?.content?.parts?.[0]?.text)}`);
      } else {
        const b = await res.text();
        let msg = b;
        try { msg = JSON.parse(b)?.error?.message ?? b; } catch {}
        console.log(`${m.padEnd(26)} ${res.status}  -> ${String(msg).slice(0, 110)}`);
      }
    } catch (e) {
      console.log(`${m.padEnd(26)} ERR  -> ${e.message}`);
    }
  }
})();
