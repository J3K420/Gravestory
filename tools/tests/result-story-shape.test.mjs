import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const modulePath = new URL('../../mobile/src/lib/story-shape.js', import.meta.url);
const source = await readFile(modulePath, 'utf8');
const storyShape = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const {
  normalizePortraits,
  normalizeResultStoryArrays,
  normalizeStoredStoryArrays,
  storyArray,
} = storyShape;

test('Result story source gating receives empty arrays for SQL nulls', () => {
  const story = {
    sources: null,
    source_urls: null,
    symbols: null,
    mentions: null,
    portraits: null,
  };
  const expected = {
    sources: [],
    sourceUrls: [],
    symbols: [],
    mentions: [],
    portraits: [],
  };

  assert.deepEqual(normalizeResultStoryArrays(story), expected);
  assert.deepEqual(normalizeResultStoryArrays(), expected);
  assert.deepEqual(normalizeResultStoryArrays(null), expected);
});

test('sync reload receives stable arrays for nullable persisted columns', () => {
  assert.deepEqual(normalizeStoredStoryArrays({
    sources: null,
    source_urls: null,
    symbols: null,
    mentions: null,
  }), {
    sources: [],
    source_urls: [],
    symbols: [],
    mentions: [],
  });
});

test('Result story arrays preserve researched sources and supported portrait shapes', () => {
  const sources = ['State archive', 'Cemetery register'];
  const sourceUrls = ['https://example.com/archive', 'https://example.com/register'];
  const symbols = ['Dove'];
  const mentions = [{ sentence: 'Named in a register.', url: sourceUrls[1] }];

  const normalized = normalizeResultStoryArrays({
    sources,
    source_urls: sourceUrls,
    symbols,
    mentions,
    portraits: { left: 'https://example.com/left.jpg', right: null },
  });

  assert.strictEqual(normalized.sources, sources);
  assert.strictEqual(normalized.sourceUrls, sourceUrls);
  assert.strictEqual(normalized.symbols, symbols);
  assert.strictEqual(normalized.mentions, mentions);
  assert.deepEqual(normalized.portraits, ['https://example.com/left.jpg']);
});

test('storyArray rejects non-arrays and portrait normalization drops empty entries', () => {
  assert.deepEqual(storyArray('not-an-array'), []);
  assert.deepEqual(storyArray({ length: 1 }), []);
  assert.deepEqual(normalizePortraits(['left.jpg', null, 'right.jpg']), ['left.jpg', 'right.jpg']);
});
