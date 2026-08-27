/* Text folding for search.
 *
 * A name typed into a search box is rarely the same string as the name saved
 * on the record. iOS smart punctuation turns ' into ’ while you type, so
 * "Sweet Caroline's" typed with a straight quote never matched the
 * "Sweet Caroline’s" already in the log — and the list just said nothing
 * matched. Fold both sides to the same shape before comparing.
 *
 * The fold: accents stripped, curly quotes and dashes flattened to ASCII,
 * lowercased, then apostrophes dropped entirely so "carolines" finds it too.
 * Dropping rather than normalising them is deliberate — people leave the
 * apostrophe out far more often than they get it wrong.
 */

const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032\u2035\u00B4\u0060]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033]/g;
const DASHES = /[\u2010-\u2015\u2212]/g;

/** Everything about a string that shouldn't change whether it matches. */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')  // the accents NFKD just split off
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does `haystack` (a string, or the pieces of a record) contain `q`?
 * An empty query matches everything, which is what a blank search box means.
 */
export function matches(haystack, q) {
  const needle = fold(q);
  if (!needle) return true;
  const hay = Array.isArray(haystack) ? haystack.filter(Boolean).join(' ') : haystack;
  return fold(hay).includes(needle);
}
