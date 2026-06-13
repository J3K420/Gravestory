// js/sample-story.js — Canned first-run example. Mirrors mobile
// src/lib/sample-story.js. Classic script: SAMPLE_STORY + openSampleStory()
// attach to window so the home-screen button's inline onclick can call it.
//
// openSampleStory() reuses the normal result renderer (renderResult + showScreen)
// rather than a dedicated screen. The _isSample flag makes renderResult hide
// save / sharing / tributes / marker and show the example banner, so the demo
// can never be persisted.
//
// Depends on (globals, all defined by call time): currentStory (index.html),
// renderResult (render-result.js), showScreen (util-dom/index.html),
// logEvent (analytics.js).

const SAMPLE_STORY = {
  _isSample: true,
  name: 'Marie Skłodowska Curie',
  dates: '1867 – 1934',
  location: 'The Panthéon, Paris, France',
  biography:
    "Born Maria Skłodowska in Warsaw in 1867, under a Russian occupation that barred women from its universities, she taught herself in a clandestine \"Flying University\" and worked as a governess to fund her sister's medical studies — on the promise the favour would one day be returned. [1]\n\n" +
    "In 1891 she travelled to Paris and enrolled at the Sorbonne, where she often studied so late and ate so little that she fainted from hunger over her books. There she met Pierre Curie, a physicist who shared her devotion to research; they married in 1895 and made the laboratory the centre of their life together. [2]\n\n" +
    "Investigating the mysterious rays given off by uranium, she coined the term \"radioactivity\" and, with Pierre, isolated two new elements — polonium, named for her homeland, and radium. The work was punishing: she refined tonnes of pitchblende by hand in a leaking shed. In 1903 the Curies shared the Nobel Prize in Physics, making Marie the first woman ever to receive one. [1][3]\n\n" +
    "Pierre's sudden death in 1906 left her grief-stricken but undeterred; she took over his professorship, becoming the first woman to teach at the Sorbonne. In 1911 she won a second Nobel Prize, this time in Chemistry — and remains the only person ever honoured in two different sciences. During the First World War she equipped mobile X-ray units, the \"petites Curies,\" and drove them to the front herself to help surgeons locate shrapnel. [2][3]\n\n" +
    "She died in 1934 of aplastic anaemia, almost certainly caused by her decades of exposure to the radiation she had named. Her notebooks remain so radioactive that they are still kept in lead-lined boxes. In 1995 she was reinterred in the Panthéon — the first woman laid there for her own achievements. [1]",
  inscription: 'MARIE CURIE-SKŁODOWSKA · 1867–1934',
  symbols: ['laurel', 'open book'],
  sources: [
    'Wikipedia — Marie Curie',
    'Nobel Prize biographical archive',
    'Encyclopædia Britannica — Marie Curie',
  ],
  source_urls: [
    'https://en.wikipedia.org/wiki/Marie_Curie',
    'https://www.nobelprize.org/prizes/physics/1903/marie-curie/biographical/',
    'https://www.britannica.com/biography/Marie-Curie',
  ],
  graveData: {
    inscription: 'MARIE CURIE-SKŁODOWSKA · 1867–1934',
    symbols: ['laurel', 'open book'],
  },
};

function openSampleStory() {
  try { logEvent(ANALYTICS_EVENTS.SAMPLE_VIEWED, {}); } catch (e) {}
  currentStory = SAMPLE_STORY;
  renderResult(SAMPLE_STORY);
  showScreen('result');
}
