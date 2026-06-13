// ===================================================================
// js/map-global.js
// -------------------------------------------------------------------
// The Global Map screen: a world map of all PUBLIC stories with GPS
// coords, fetched from Supabase and cached in sessionStorage for 5
// minutes. Distinct from the Cemetery Map (single-cemetery view of
// the current user's saved stories) -- different Leaflet instance,
// different data source, different markers.
//
// MODULE SURFACE (top-level fn declarations auto-attach to window):
//   openGlobalMap()           - showScreen + lazy init
//   fetchGlobalStories()      - Supabase fetch + 5-min sessionStorage cache
//   initGlobalMap()           - build Leaflet map + place markers
//   buildGlobalPopup(story)   - popup HTML with guest-gated actions
//   viewGlobalStory(storyId)  - fetch one story by id, render, navigate
//   guardGuestAction(action)  - run action if signed in, else open gate modal
//   closeGuestGate()          - hide gate modal
//   viewStoryFromMap(index)   - jump to a SAVED story by index (cemetery-map sidebar)
//
// MODULE-LOCAL STATE (let-bound; intentionally NOT on window):
//   globalLeafletMap          - the L.map instance (or null)
//   globalMapMarkers          - L.marker[] currently on the map
//
// MODULE-LOCAL CONSTANTS:
//   GLOBAL_MAP_CACHE_KEY      - sessionStorage key
//   GLOBAL_MAP_CACHE_TTL_MS   - 5 minutes
//
// EXTERNAL DEPENDENCIES (resolved via window at call time):
//   showScreen()              - inline override in index.html
//   supabaseClient            - js/auth.js (module-local but window-visible)
//   currentUser               - js/auth.js
//   currentStory              - inline state var in index.html
//   renderResult()            - js/render-result.js
//   savedStories              - inline state var in index.html (read by viewStoryFromMap)
//   Leaflet (L)               - CDN-loaded global
//
// CROSS-BOUNDARY CALLS INTO THIS MODULE:
//   openGlobalMap     - 1 HTML onclick (home-screen "Global Map" button)
//   closeGuestGate    - 2 HTML onclick (guest-gate modal buttons)
//   guardGuestAction  - called from constructed popup onclick strings
//   viewGlobalStory   - called from constructed popup onclick strings
//   viewStoryFromMap  - called from js/map-cemetery.js buildPopupBio's
//                       constructed onclick string, AND from cemetery-map
//                       sidebar list onclick (resolves via window).
//
// SOURCE PROVENANCE: extracted in Stage 12 from index.html lines
// 1043–1244 (the global-map block). viewStoryFromMap travelled with
// the block because the original code placed it physically inside the
// global-map region; semantically it is a saved-story navigator that
// the cemetery-map module also depends on. Promotion to a shared
// story-nav module is deferred as a future cleanup.
// ===================================================================

// ── GLOBAL MAP ───────────────────────────────────────────────────
let globalLeafletMap = null;
let globalMapMarkers = [];

const GLOBAL_MAP_CACHE_KEY = 'gs_global_map_cache_v1';
const GLOBAL_MAP_CACHE_TTL_MS = 5 * 60 * 1000;

async function openGlobalMap() {
  showScreen('global-map-screen');
  setTimeout(async () => {
    await initGlobalMap();
    if (globalLeafletMap) {
      setTimeout(() => globalLeafletMap.invalidateSize(), 200);
    }
  }, 100);
}

async function fetchGlobalStories() {
  // Try session cache first
  try {
    const raw = sessionStorage.getItem(GLOBAL_MAP_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.fetched_at && (Date.now() - parsed.fetched_at) < GLOBAL_MAP_CACHE_TTL_MS) {
        console.log('🌍 Using cached global stories:', parsed.stories.length);
        return parsed.stories;
      }
    }
  } catch (e) { /* ignore cache errors */ }

  const limit = currentUser ? 500 : 50;
  try {
    const { data, error } = await supabaseClient.rpc('global_public_stories', { p_limit: limit });
    if (error) throw error;
    const mapped = (data || []).map(row => ({
      id: row.id,
      timestamp: row.client_timestamp || new Date(row.created_at).getTime(),
      name: row.name,
      dates: row.dates,
      biography: row.biography,
      location: row.location,
      inscription: row.inscription,
      symbols: row.symbols,
      family_name: row.family_name,
      notes: row.notes,
      sources: row.sources,
      source_urls: row.source_urls,
      gps: (row.latitude != null && row.longitude != null) ? { lat: row.latitude, lng: row.longitude } : null,
      userCorrected: row.user_corrected,
      _lowConfidence: row.low_confidence,
      is_public: true,
      image_url: row.image_url || null,
      portrait_left_url: row.portrait_left_url || null,
      portrait_right_url: row.portrait_right_url || null,
      grave_id: row.grave_id || null,
      marker_style: row.marker_style || null,
      source: row.source || 'library',
      _contributor: row.contributor_name || 'Anonymous',
      _isGlobal: true
    }));

    // One pin per canonical grave: deduplicate by grave_id, then by ~20 m GPS cell
    const stories = [];
    const seenGraves = new Set();
    const seenCells = new Set();
    for (const s of mapped) {
      if (s.grave_id) {
        if (seenGraves.has(s.grave_id)) continue;
        seenGraves.add(s.grave_id);
      } else if (s.gps) {
        const cell = `${Math.round(s.gps.lat * 5000)},${Math.round(s.gps.lng * 5000)}`;
        if (seenCells.has(cell)) continue;
        seenCells.add(cell);
      }
      stories.push(s);
    }
    try {
      sessionStorage.setItem(GLOBAL_MAP_CACHE_KEY, JSON.stringify({
        fetched_at: Date.now(),
        stories
      }));
    } catch (e) { /* sessionStorage full or disabled — fine */ }
    return stories;
  } catch (e) {
    console.warn('🌍 fetchGlobalStories failed:', e.message);
    return [];
  }
}

async function initGlobalMap() {
  const countEl = document.getElementById('global-map-count');
  const statusEl = document.getElementById('global-map-status');
  const listEl = document.getElementById('global-graves-list');
  countEl.textContent = 'loading…';
  statusEl.textContent = '';
  listEl.innerHTML = '';

  // Tear down a previous instance if reopening
  if (globalLeafletMap) {
    globalLeafletMap.remove();
    globalLeafletMap = null;
    globalMapMarkers = [];
  }
  // Clear the story lookup so old entries don't accumulate across map opens
  window._globalStoryLookup = {};

  const stories = await fetchGlobalStories();
  const withGps = stories.filter(s => s.gps);

  countEl.textContent = withGps.length === 0
    ? 'no shared stories yet'
    : `${withGps.length} ${withGps.length === 1 ? 'story' : 'stories'}`;

  if (!currentUser) {
    statusEl.textContent = 'Guest view — limited to 50 most recent. Sign in to see up to 500.';
  } else {
    statusEl.textContent = '';
  }

  // Initialize map at world view by default
  globalLeafletMap = L.map('global-leaflet-map').setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    subdomains: 'abc',
    keepBuffer: 4,
    updateWhenZooming: false,
    updateWhenIdle: true,
    crossOrigin: true
  }).addTo(globalLeafletMap);

  if (withGps.length === 0) {
    listEl.innerHTML = '<p style="font-family:Crimson Pro,serif;font-style:italic;color:var(--stone);font-size:0.85rem;">No public stories yet. Share one of yours from its bio page to be first on the map.</p>';
    return;
  }

  // Global pins render the grave's first-wins chosen marker (the same 20 gold
  // glyphs as the cemetery map). An unstaked grave (marker_style null) falls
  // back to the default 'book' glyph via graveMarkerSvg(). Low-confidence pins
  // keep the faded look + "?" badge.
  const makeGlobalIcon = (lowConfidence, styleId) => L.divIcon({
    html: `<div style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));line-height:0;position:relative;width:32px;height:32px;${lowConfidence ? 'opacity:0.75;' : ''}">${graveMarkerSvg(styleId, 32)}${lowConfidence ? '<div style="position:absolute;top:-4px;right:-6px;width:14px;height:14px;border-radius:50%;background:rgba(30,40,55,0.95);border:1px solid #aabedc;color:#cfddf2;font-family:serif;font-size:10px;font-weight:bold;line-height:12px;text-align:center;">?</div>' : ''}</div>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24]
  });

  withGps.forEach(story => {
    const marker = L.marker([story.gps.lat, story.gps.lng], { icon: makeGlobalIcon(story._lowConfidence, story.marker_style), draggable: false, story: story })
      .addTo(globalLeafletMap)
      .bindPopup(buildGlobalPopup(story), { maxWidth: 320 });
    globalMapMarkers.push(marker);
  });

  // Fit map to all loaded pins
  if (globalMapMarkers.length === 1) {
    globalLeafletMap.setView(globalMapMarkers[0].getLatLng(), 13);
  } else {
    const group = L.featureGroup(globalMapMarkers);
    globalLeafletMap.fitBounds(group.getBounds().pad(0.2));
  }
}

function buildGlobalPopup(story) {
  // Strictly read-only popup. Read/Go-to-bio buttons gate guests.
  const safeContrib = escapeHtml(story._contributor || 'Anonymous');
  const bioId = 'gbio-' + (story.timestamp || Math.random().toString(36).slice(2));
  const paragraphs = (story.biography || '').split('\n\n').filter(p => p.trim()).slice(0, 2);
  // Biography text comes from other users' Supabase rows — must be escaped before injection
  const bioHtml = paragraphs.map(p => `<p style="margin:0.4rem 0;font-size:0.85rem;line-height:1.4;color:#333;">${escapeHtml(p)}</p>`).join('');

  // Store the story object in the lookup (initialised in initGlobalMap before any markers are placed)
  window._globalStoryLookup[story.id] = story;

  const thumb = story.image_url
    ? `<img src="${escapeHtml(story.image_url)}" alt="" loading="lazy" style="width:100%;max-height:140px;object-fit:cover;border-radius:3px;margin-bottom:0.5rem;">`
    : '';
  return `
    <div style="font-family:'Playfair Display',serif;min-width:150px;max-width:300px;">
      ${thumb}
      <strong>${escapeHtml(story.name || 'Unknown')}</strong><br>
      <em style="font-size:0.85rem;color:#666">${escapeHtml(story.dates || '')}</em><br>
      <small style="color:#888">${escapeHtml(story.location || '')}</small><br>
      <small style="color:#7a8a9a;font-size:0.72rem;font-style:italic">Shared by ${safeContrib}</small>
      ${story._lowConfidence ? '<br><span style="font-size:0.75rem;color:#a87a2a">⚠ approximate location</span>' : ''}
      <div style="margin-top:0.5rem;display:flex;gap:0.4rem;flex-wrap:wrap;">
        <button onclick="guardGuestAction(function(){var c=document.getElementById('${bioId}');if(c.style.display==='none'){c.style.display='block';this.textContent='▲ Hide bio';}else{c.style.display='none';this.textContent='▼ Read bio';}}.bind(this))"
          style="background:none;border:1px solid rgba(120,140,180,0.5);color:#3d5a85;font-family:'Crimson Pro',serif;font-size:0.8rem;padding:0.25rem 0.6rem;cursor:pointer;border-radius:3px;">
          ▼ Read bio
        </button>
        <button onclick="guardGuestAction(function(){viewGlobalStory('${story.id}');})"
          style="background:rgba(120,140,180,0.15);border:1px solid rgba(120,140,180,0.5);color:#3d5a85;font-family:'Crimson Pro',serif;font-size:0.8rem;padding:0.25rem 0.6rem;cursor:pointer;border-radius:3px;">
          → Go to bio
        </button>
      </div>
      <div id="${bioId}" style="display:none;margin-top:0.4rem;width:260px;height:160px;overflow-y:auto;overflow-x:hidden;padding:0.3rem 0.5rem;border:1px solid rgba(120,140,180,0.3);background:rgba(240,245,252,0.7);border-radius:3px;">${bioHtml}</div>
    </div>
  `;
}

function viewGlobalStory(storyId) {
  const story = window._globalStoryLookup && window._globalStoryLookup[storyId];
  if (!story) { console.warn('Global story not in lookup:', storyId); return; }
  currentStory = story;
  renderResult(currentStory);
  showScreen('result');
}

function guardGuestAction(action) {
  if (!currentUser) {
    document.getElementById('guest-gate-modal').classList.remove('hidden');
    return;
  }
  try { action(); } catch (e) { console.warn('Guest-gated action threw:', e); }
}

function closeGuestGate() {
  document.getElementById('guest-gate-modal').classList.add('hidden');
}

function viewStoryFromMap(index) {
  currentStory = savedStories[index];
  renderResult(currentStory);
  showScreen('result');
}
