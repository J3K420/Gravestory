// user-prefs.js — User preferences (display name, default visibility, admin flag) (extracted Stage 4)

// ── USER PREFS (display name + default visibility) ───────────────
// Cached in memory after first load; written through to Supabase on change.
let userPrefs = { default_visibility: 'prompt', display_name: null, is_admin: false };

function isAdmin() {
  return !!(currentUser && userPrefs && userPrefs.is_admin);
}

async function loadUserPrefs() {
  if (!currentUser) {
    userPrefs = { default_visibility: 'prompt', display_name: null, is_admin: false };
    return;
  }
  try {
    const { data, error } = await supabaseClient
      .from('user_prefs')
      .select('default_visibility, display_name, is_admin')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      userPrefs = {
        default_visibility: data.default_visibility || 'prompt',
        display_name: data.display_name || null,
        is_admin: !!data.is_admin
      };
    } else {
      userPrefs = { default_visibility: 'prompt', display_name: null, is_admin: false };
    }
  } catch (e) {
    console.warn('⚙️ loadUserPrefs failed:', e.message);
  }
}

async function saveUserPrefs(patch) {
  if (!currentUser) return;
  const merged = { ...userPrefs, ...patch };
  try {
    const { error } = await supabaseClient
      .from('user_prefs')
      .upsert({
        user_id: currentUser.id,
        default_visibility: merged.default_visibility,
        display_name: merged.display_name
      }, { onConflict: 'user_id' });
    if (error) throw error;
    userPrefs = merged;
    console.log('⚙️ Prefs saved:', merged);
  } catch (e) {
    console.warn('⚙️ saveUserPrefs failed:', e.message);
    alert('Could not save settings: ' + e.message);
  }
}

function openSettings() {
  document.getElementById('user-menu-dropdown').style.display = 'none';
  if (!currentUser) { showScreen('auth'); return; }
  // Populate from cache
  document.getElementById('settings-display-name').value = userPrefs.display_name || '';
  const vis = userPrefs.default_visibility || 'prompt';
  document.querySelectorAll('input[name="settings-visibility"]').forEach(r => {
    r.checked = (r.value === vis);
  });
  document.getElementById('settings-status').textContent = '';
  showScreen('settings');
}

async function submitSettings() {
  const nameRaw = document.getElementById('settings-display-name').value.trim();
  const vis = document.querySelector('input[name="settings-visibility"]:checked')?.value || 'prompt';
  const status = document.getElementById('settings-status');
  status.textContent = 'Saving…';
  await saveUserPrefs({
    display_name: nameRaw || null,
    default_visibility: vis
  });
  status.textContent = '✓ Saved';
  setTimeout(() => { status.textContent = ''; }, 2000);
}
