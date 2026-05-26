// util-html.js — HTML escaping utilities (extracted Stage 4)

// Small HTML-escaper for error messages (which may contain quotes / brackets).
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
