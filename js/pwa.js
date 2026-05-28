// ── PWA SERVICE WORKER + INSTALL PROMPT ─────────────────────────
// Self-contained PWA bootstrap. Two side-effects at load time:
//   1. Conditional service worker registration (https only).
//   2. beforeinstallprompt listener — captures the deferred event
//      for later use by the install banner.
//
// Stage-4 timing-lesson audit: this module runs in <head>, before
// HTML parsing reaches <body>. Verified safe:
//   - The SW registration does no DOM reads at load time.
//   - The beforeinstallprompt listener registers on window; the
//     event itself only fires after the page is fully loaded by
//     browser guarantee, and the only DOM read (#install-banner)
//     happens inside a 3000ms setTimeout after that, so DOM is
//     unambiguously parsed by the time getElementById runs.
// No DOMContentLoaded guard needed.
//
// Module-level state:
//   - deferredPrompt (captured beforeinstallprompt event; null
//     until the browser fires it).

// ── PWA SERVICE WORKER ───────────────────────────────────────────
// Browsers reject blob: URLs for SW registration (security restriction),
// so the SW lives in sw.js at the repo root and is registered by path.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('✅ GraveStory PWA ready'))
    .catch(err => console.log('SW skipped:', err));
}

// ── ADD TO HOME SCREEN PROMPT ─────────────────────────────────────
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Show install banner after a short delay
  setTimeout(showInstallBanner, 3000);
});

function showInstallBanner() {
  if (!deferredPrompt) return;
  const banner = document.getElementById('install-banner');
  if (banner) banner.classList.remove('hidden');
}

function installPWA() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(choice => {
    deferredPrompt = null;
    document.getElementById('install-banner').classList.add('hidden');
  });
}

function dismissInstallBanner() {
  const banner = document.getElementById('install-banner');
  if (banner) banner.classList.add('hidden');
  deferredPrompt = null;
}

// ── iOS INSTALL HINT (folded in Stage 8) ─────────────────────────────
// Detects iOS Safari that hasn't been added to the Home Screen yet,
// and reveals the #ios-install-hint element. Called once at app init
// from the inline INIT block in index.html. Folded here from inline
// rather than getting its own ios-install.js module — it belongs
// logically with the PWA install plumbing above. Public API:
//   - isIOS(), isInStandaloneMode(), checkIOSInstallHint()
// ── iOS INSTALL HINT ───────────────────────────────────────────────
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
}

function checkIOSInstallHint() {
  const hint = document.getElementById('ios-install-hint');
  if (!hint) return;
  // Show hint on iOS Safari if not already installed as PWA
  if (isIOS() && !isInStandaloneMode()) {
    hint.style.display = 'block';
  }
}
