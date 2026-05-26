// ─── Module: auth.js ───
//
// Supabase authentication: client construction, session bootstrap, sign-in/up/out,
// user-menu dropdown, and auth-state listeners. Extracted in Stage 6 of the
// gravestory refactor (was lines 1272-1414 of index.html pre-extraction).
//
// LOAD ORDER REQUIREMENTS:
//   - Must load AFTER the Supabase library script tag (@supabase/supabase-js),
//     because `const supabaseClient = window.supabase.createClient(...)` runs
//     at script-parse time.
//   - Other modules (sync.js, persistence.js, user-prefs.js, biography.js) read
//     `supabaseClient` and `currentUser` only inside function bodies — those
//     references resolve lazily at call time, so the load-order requirement is
//     just "before any of those functions actually fires," which is trivially
//     true since they all fire post-DOMContentLoaded.
//
// EXPOSED GLOBALS (via classic-script shared lexical scope):
//   - supabaseClient  : the Supabase JS client instance (const)
//   - currentUser     : the current Supabase user object or null (let, reassigned
//                       on every auth-state change, also written by signOut)
//   - initAuth, updateUserMenu, toggleUserMenu, signInWithGoogle, signInWithEmail,
//     signUpWithEmail, signOut : function declarations, reachable from any other
//     classic script via plain identifier reference.
//
// SIDE EFFECTS AT LOAD TIME (Stage-4 timing-lesson audit):
//   1. Supabase client construction — touches only `window.supabase`, safe in <head>.
//   2. `document.addEventListener('click', ...)` for outside-click dropdown close —
//      registers on `document`, which exists during <head> parse. The handler
//      reads `getElementById('user-menu')` lazily at click time (post-DOM). Safe.
//   3. `window.addEventListener('DOMContentLoaded', initAuth)` — registers a
//      DOMContentLoaded listener. Since this script runs during <head> parse,
//      DOMContentLoaded has not yet fired, so the listener will be invoked
//      correctly when DOM parsing completes. Safe.
//
// EXTERNAL SYMBOLS CONSUMED:
//   - window.supabase       (Supabase JS library — loaded before this module)
//   - loadUserPrefs()       (user-prefs.js)
//   - syncOnSignIn()        (sync.js)
//   - showScreen()          (still inline in index.html)
//   - savedStories          (inline `let` in index.html — written by signOut)
//   - renderSavedList()     (still inline in index.html)
//   - updateHomeMapButton() (still inline in index.html)
//
// SIBLING NOTE: the visibilitychange -> syncDelta listener that sat immediately
// after this block (lines 1417-1421 of pre-extraction index.html) reads
// `currentUser` but belongs to sync-glue, not auth. It stays inline for now;
// when a future stage extracts sync-glue, that listener should travel with it.

// ── SUPABASE AUTH ──────────────────────────────────────────────
// PASTE YOUR ANON KEY HERE between the quotes (the public one, safe for client use):
const SUPABASE_URL = 'https://idbrjonofqrsykqsqpwo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkYnJqb25vZnFyc3lrcXNxcHdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MDYyMTUsImV4cCI6MjA5NDI4MjIxNX0.hF26KwrkhWRy7Z74YnEd6Oqr3brPSOOz9ykRQZOBWiw';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

let currentUser = null;

// Initialize auth state on page load
async function initAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  currentUser = session?.user || null;
  if (currentUser) await loadUserPrefs();
  updateUserMenu();

  // Listen for sign-in / sign-out events
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    const wasSignedOut = !currentUser;
    currentUser = session?.user || null;
    updateUserMenu();
    if (event === 'SIGNED_IN') {
      console.log('✅ Signed in as', currentUser.email);
      await loadUserPrefs();
      await syncOnSignIn();
      if (wasSignedOut) showScreen('home');
    }
    if (event === 'SIGNED_OUT') {
      console.log('👋 Signed out');
    }
  });

  // If we restored an existing session on page load, sync right away
  if (currentUser) {
    await syncOnSignIn();
  }
}

function updateUserMenu() {
  const label = document.getElementById('user-menu-label');
  const dropdown = document.getElementById('user-menu-dropdown');
  const emailRow = document.getElementById('user-menu-email');
  if (!label) return;

  if (currentUser) {
    const name = currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'Account';
    label.textContent = name;
    emailRow.textContent = currentUser.email || '';
    // Make the button click toggle the dropdown instead of opening auth screen
    document.getElementById('user-menu-btn').onclick = toggleUserMenu;
  } else {
    label.textContent = 'Sign in';
    dropdown.style.display = 'none';
    document.getElementById('user-menu-btn').onclick = () => showScreen('auth');
  }
}

function toggleUserMenu() {
  const dropdown = document.getElementById('user-menu-dropdown');
  if (!currentUser) { showScreen('auth'); return; }
  dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

// Close the dropdown when clicking outside it
document.addEventListener('click', (e) => {
  const menu = document.getElementById('user-menu');
  if (menu && !menu.contains(e.target)) {
    const dropdown = document.getElementById('user-menu-dropdown');
    if (dropdown) dropdown.style.display = 'none';
  }
});

async function signInWithGoogle() {
  // Use a clean URL (no hash or query) so Supabase's redirect fragment doesn't collide
  const cleanUrl = window.location.origin + window.location.pathname;
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: cleanUrl }
  });
  if (error) {
    document.getElementById('auth-status').textContent = '❌ ' + error.message;
  }
}

async function signInWithEmail() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const status = document.getElementById('auth-status');
  if (!email || !password) { status.textContent = 'Email and password required'; return; }

  status.textContent = 'Signing in...';
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    status.textContent = '❌ ' + error.message;
  } else {
    status.textContent = '✅ Signed in';
  }
}

async function signUpWithEmail() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const status = document.getElementById('auth-status');
  if (!email || !password) { status.textContent = 'Email and password required'; return; }
  if (password.length < 6) { status.textContent = 'Password must be at least 6 characters'; return; }

  status.textContent = 'Creating account...';
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) {
    status.textContent = '❌ ' + error.message;
  } else if (data.user && !data.session) {
    status.textContent = '✅ Check your email to verify your account';
  } else {
    status.textContent = '✅ Account created — signing in...';
  }
}

async function signOut() {
  // Wipe sync state and local cache BEFORE Supabase fires its SIGNED_OUT event
  // so the next sign-in (possibly as a different user) starts clean.
  const userId = currentUser?.id;
  if (userId) {
    localStorage.removeItem(`gs_last_sync_${userId}`);
  }
  localStorage.removeItem('gravestories');

  await supabaseClient.auth.signOut();

  // Wipe in-memory state too
  savedStories = [];
  document.getElementById('user-menu-dropdown').style.display = 'none';
  renderSavedList();
  updateHomeMapButton();
}

// Run auth init on page load
window.addEventListener('DOMContentLoaded', initAuth);
