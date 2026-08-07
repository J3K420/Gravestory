export function storyArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeStoredStoryArrays(story) {
  return {
    sources: storyArray(story?.sources),
    source_urls: storyArray(story?.source_urls),
    symbols: storyArray(story?.symbols),
    mentions: storyArray(story?.mentions),
  };
}

export function normalizePortraits(portraits) {
  if (!portraits) return [];
  if (Array.isArray(portraits)) return portraits.filter(Boolean);
  return [portraits.left, portraits.right].filter(Boolean);
}

export function normalizeResultStoryArrays(story) {
  const {
    sources,
    source_urls,
    symbols,
    mentions,
  } = normalizeStoredStoryArrays(story);
  return {
    sources,
    sourceUrls: source_urls,
    symbols,
    mentions,
    portraits: normalizePortraits(story?.portraits),
  };
}
