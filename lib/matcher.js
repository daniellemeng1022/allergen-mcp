// matcher.js - Pure matching logic, shared by content.js and testable in Node.
// It knows nothing about the browser: give it page text, a user's allergen
// list and the allergen map, and it returns what matched and why.
(function (root) {
  const SEVERITY_ORDER = { severe: 3, moderate: 2, mild: 1 };

  // Chinese / Japanese / Korean text has no spaces between words,
  // so for those terms we use a plain substring search.
  const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

  const regexCache = new Map();

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // "peanut: severe", "peanut - severe", "peanut (severe)" -> {name, severity}
  function parseEntry(line) {
    const text = String(line || '').trim();
    const m = text.match(/^(.*?)[\s:\-–(]+(severe|moderate|mild)\)?$/i);
    if (m && m[1].trim()) {
      return { name: m[1].trim(), severity: m[2].toLowerCase() };
    }
    return { name: text, severity: 'moderate' };
  }

  function termRegex(term) {
    const key = term.toLowerCase();
    if (regexCache.has(key)) return regexCache.get(key);
    // Whole-word match (Unicode-aware), allow plural "s"/"es", and let spaces
    // in multi-word terms match hyphens too ("half and half" / "half-and-half").
    const body = escapeRegex(key).replace(/[\s-]+/g, '[\\s\\-]+');
    const re = new RegExp('(?<![\\p{L}\\p{N}])' + body + '(?:e?s)?(?![\\p{L}\\p{N}])', 'iu');
    regexCache.set(key, re);
    return re;
  }

  function containsTerm(text, term) {
    const lower = term.toLowerCase();
    if (CJK.test(lower)) return text.includes(lower);
    return termRegex(lower).test(text);
  }

  function removeTerm(text, term) {
    const lower = term.toLowerCase();
    if (CJK.test(lower)) return text.split(lower).join(' ');
    const re = new RegExp(termRegex(lower).source, 'giu');
    return text.replace(re, ' ');
  }

  // Pages use many kinds of hyphens and spaces ("Gluten‑Free" with a
  // non-breaking hyphen); make them plain so the rules below see them.
  function normalize(text) {
    return String(text || '')
      .replace(/[‐-―−﹘﹣－]/g, '-')
      .replace(/[   ]/g, ' ')
      .toLowerCase();
  }

  // Statements that say an allergen is ABSENT ("dairy-free", "free from nuts",
  // "contains no milk", "made without gluten", "0g gluten"). Each phrase stops at
  // punctuation, so "No preservatives. Contains milk." still alerts on milk.
  const NEGATIONS = [
    /(?:does not|doesn't|do not|don't) contain[^.;:\n]{0,80}/giu,
    /free (?:from|of)[^.;:\n]{0,80}/giu,
    /contains? no [^.;:,\n]{1,40}/giu,
    /(?<![\p{L}])(?:made |prepared |produced )?without [^.;:,\n]{1,40}/giu,
    /(?<![\p{L}])no added [^.;:,\n]{1,30}/giu,
    /(?<![\p{L}])no [\p{L}'’ -]{1,30}? added(?![\p{L}])/giu,
    /(?<![\p{L}\p{N}.,])(?:0|zero) ?(?:g|mg|grams?)? [\p{L}'’-]+/giu,
    /[\p{L}'’]+[\s\-]free(?![\p{L}])/giu
  ];

  // Returns the text with "absent" statements removed, plus the statements
  // themselves, so an alert can say when a page claims one thing and lists another.
  function splitNegations(text) {
    const claims = [];
    let out = text;
    NEGATIONS.forEach(re => {
      out = out.replace(re, m => { claims.push(m.trim()); return ' '; });
    });
    return { text: out, claims };
  }

  function stripNegations(text) {
    return splitNegations(normalize(text)).text;
  }

  // Map what a user typed ("Peanuts", "dairy") to an allergen in the map.
  function resolveAllergen(name, map) {
    const wanted = name.toLowerCase().trim();
    const candidates = [wanted, wanted.replace(/e?s$/, ''), wanted + 's'];
    for (const [key, entry] of Object.entries((map && map.allergens) || {})) {
      const names = [key.replace(/_/g, ' '), ...(entry.aliases || [])].map(n => n.toLowerCase());
      if (candidates.some(c => names.includes(c))) return key;
    }
    return null;
  }

  // Returns [{name, label, severity, hits: [{term, why}], claim}] for every allergen
  // in `entries` (lines the user typed) that appears in `pageText`. A "free" claim
  // never hides a real ingredient: if the page says "gluten-free" but lists malted
  // barley, the alert stays and `claim` holds the page's own words.
  function findMatches(pageText, entries, map) {
    const { text: base, claims } = splitNegations(normalize(pageText));
    const results = [];

    entries.forEach(line => {
      const { name, severity } = parseEntry(line);
      if (!name) return;

      const key = resolveAllergen(name, map);
      const entry = key ? map.allergens[key] : null;

      // Terms to look for: the name itself, its aliases, then the map's terms.
      const terms = [{ t: name, why: '' }];
      if (entry) {
        (entry.aliases || []).forEach(a => terms.push({ t: a, why: '' }));
        (entry.terms || []).forEach(t => terms.push(t));
      }

      // Blank out look-alikes first ("buckwheat" for wheat, "coconut milk" for milk).
      let text = base;
      ((entry && entry.exclude) || []).forEach(x => { text = removeTerm(text, x); });

      const hits = [];
      const seen = new Set();
      terms.forEach(({ t, why }) => {
        const lower = t.toLowerCase();
        if (seen.has(lower)) return;
        seen.add(lower);
        if (containsTerm(text, lower)) hits.push({ term: t, why: why || '' });
      });

      if (hits.length > 0) {
        const names = [name, ...((entry && entry.aliases) || [])];
        const claim = claims.find(c => names.some(n => containsTerm(c, n.toLowerCase()))) || '';
        results.push({ name, label: entry ? entry.label : name, severity, hits, claim });
      }
    });

    return results;
  }

  // Product-page URL patterns for stores we know. On these sites, any other page
  // (homepage, search, category, cart) is skipped: it shows many products at once.
  const STORE_PRODUCT_PATHS = [
    { host: /(^|\.)amazon\./, product: /\/(dp|gp\/product|gp\/aw\/d)\// },
    { host: /(^|\.)walmart\.com$/, product: /\/ip\// },
    { host: /(^|\.)target\.com$/, product: /\/p\// },
    { host: /(^|\.)instacart\.com$/, product: /\/products\// },
    { host: /(^|\.)sayweee\.com$/, product: /\/product\// },
    { host: /(^|\.)sephora\.com$/, product: /\/product\// },
    { host: /(^|\.)ulta\.com$/, product: /\/p\// },
    { host: /(^|\.)iherb\.com$/, product: /\/pr\// },
    { host: /(^|\.)costco\.com$/, product: /\.product\./ },
    { host: /(^|\.)kroger\.com$/, product: /\/p\// }
  ];

  // 'product', 'not_product', or 'unknown' (unknown site: decide from page content).
  function classifyUrl(url) {
    let u;
    try { u = new URL(url); } catch (e) { return 'not_product'; }
    if (u.pathname === '/' || u.pathname === '') return 'not_product';
    const store = STORE_PRODUCT_PATHS.find(s => s.host.test(u.hostname));
    if (store) return store.product.test(u.pathname) ? 'product' : 'not_product';
    return 'unknown';
  }

  function worstSeverity(matches) {
    return matches.reduce((worst, m) =>
      SEVERITY_ORDER[m.severity] > SEVERITY_ORDER[worst] ? m.severity : worst, 'mild');
  }

  const api = { parseEntry, findMatches, resolveAllergen, worstSeverity, stripNegations, classifyUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AllergenMatcher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
