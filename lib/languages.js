// languages.js - Guesses what language ingredient text is in, so a word like "ou"
// (Romanian for egg, French for "or") only counts on text in its own language.
// The extension gets this from the page and Chrome; here there is only the text.
// Each source can only add languages. If nothing is known, returns null and every
// word counts. The detector's first guess is often wrong on short text, so its top
// two count, and it is not trusted alone below MIN_WORDS: there, a false alarm is
// better than missing a real allergen.
const { detectAll } = require('tinyld');

// Same list as the extension's content.js.
const LABEL_LANGS = [
  [/\bingredients?\b/iu, ['en']], [/ingrédients?/iu, ['fr']], [/ingredientes/iu, ['es', 'pt']],
  [/ingredienti/iu, ['it']], [/ingrediënten|ingredienten/iu, ['nl']], [/\bingrediente\b/iu, ['ro', 'es', 'pt']],
  [/zutaten|inhaltsstoffe/iu, ['de']], [/składniki/iu, ['pl']], [/ingredienser/iu, ['sv', 'da', 'no']],
  [/ainesosat/iu, ['fi']], [/συστατικά/iu, ['el']], [/složení/iu, ['cs']], [/összetevők/iu, ['hu']],
  [/состав/iu, ['ru']], [/склад/iu, ['uk']], [/içindekiler|bileşenler/iu, ['tr']], [/مكونات/u, ['ar']],
  [/ترکیبات|ترکيبات|مواد تشکیل/u, ['fa']], [/רכיבים/u, ['he']]
];
const DETECTOR_GUESSES = 2;
const MIN_WORDS = 12;
const MAX_TEXT = 5000;

function inferLanguages(text, language) {
  const langs = language ? [language] : [];
  LABEL_LANGS.forEach(([re, codes]) => { if (re.test(text)) langs.push(...codes); });
  if (!langs.length && text.split(/\s+/).length < MIN_WORDS) return null;
  langs.push(...detectAll(text.slice(0, MAX_TEXT)).slice(0, DETECTOR_GUESSES).map(g => g.lang));
  return langs.length ? [...new Set(langs)] : null;
}

module.exports = { inferLanguages };
