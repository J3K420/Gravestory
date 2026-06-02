export function safeParseJSON(text, fallback = {}) {
  try {
    const clean = text.replace(/```json|```/gi, '').trim();
    return JSON.parse(clean);
  } catch (e1) {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch (e2) {
      try {
        const clean2 = text.replace(/```json|```/gi, '').trim();
        const lastBrace = clean2.lastIndexOf('}');
        if (lastBrace > 0) return JSON.parse(clean2.substring(0, lastBrace + 1));
      } catch (e3) {}
    }
  }
  return fallback;
}
