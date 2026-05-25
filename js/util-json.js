// ── SAFE JSON PARSER ─────────────────────────────────────────────
function safeParseJSON(text, fallback) {
  fallback = fallback || {};
  try {
    var clean = text.replace(/```json|```/gi, '').trim();
    return JSON.parse(clean);
  } catch(e1) {
    try {
      var match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch(e2) {
      try {
        var clean2 = text.replace(/```json|```/gi, '').trim();
        var lastBrace = clean2.lastIndexOf('}');
        if (lastBrace > 0) return JSON.parse(clean2.substring(0, lastBrace + 1));
      } catch(e3) {}
    }
  }
  return fallback;
}
