// mobile/src/lib/api-chroniclingamerica.js
// Direct queries to the Library of Congress Chronicling America API.
// Free, no key required. Covers digitised US newspapers through 1924.
// Replaces the Tavily "site:chroniclingamerica.loc.gov" query slot, freeing
// that Tavily credit for a better general historical obituary search.
// Called in parallel with Tavily; results merged into searchResults before generateBiography.

export async function searchChroniclingAmerica(name, deathYear) {
  if (!name || !deathYear) return [];
  const year = parseInt(deathYear, 10);
  if (isNaN(year) || year > 1924) return [];

  const q = encodeURIComponent(`"${name}" ${deathYear}`);
  const url = `https://www.loc.gov/collections/chronicling-america/?q=${q}&fo=json&c=5`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'GraveStory/1.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).slice(0, 3).map(r => ({
      title: r.title || 'Chronicling America',
      url: r.id || r.url || '',
      content: (Array.isArray(r.description) ? r.description.join(' ') : (r.description || '')).slice(0, 800),
      source_type: 'public_domain',
    }));
  } catch {
    return [];
  }
}
