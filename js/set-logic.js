/**
 * set-logic.js — Core Set game validation and search utilities.
 */

/**
 * Check whether a feature value across three cards is valid for a Set:
 * all three values must be all-same OR all-different.
 * @param {any} a
 * @param {any} b
 * @param {any} c
 * @returns {boolean}
 */
function featureValid(a, b, c) {
  const allSame = (a === b && b === c);
  const allDiff = (a !== b && b !== c && a !== c);
  return allSame || allDiff;
}

/**
 * Determine whether three cards form a valid Set.
 * @param {object} a
 * @param {object} b
 * @param {object} c
 * @returns {boolean}
 */
export function isSet(a, b, c) {
  return (
    featureValid(a.color, b.color, c.color) &&
    featureValid(a.shape, b.shape, c.shape) &&
    featureValid(a.count, b.count, c.count) &&
    featureValid(a.fill,  b.fill,  c.fill)
  );
}

/**
 * Yield every unique combination of three cards from the array.
 * @param {object[]} cards
 * @yields {[object, object, object]}
 */
function* triplets(cards) {
  for (let i = 0; i < cards.length - 2; i++) {
    for (let j = i + 1; j < cards.length - 1; j++) {
      for (let k = j + 1; k < cards.length; k++) {
        yield [cards[i], cards[j], cards[k]];
      }
    }
  }
}

/**
 * Find all valid Sets in an array of cards.
 * Returns an array of triplets (each triplet is [cardA, cardB, cardC]).
 * @param {object[]} cards
 * @returns {Array<[object, object, object]>}
 */
export function findAllSets(cards) {
  const results = [];
  for (const triplet of triplets(cards)) {
    if (isSet(...triplet)) results.push(triplet);
  }
  return results;
}

/**
 * Quick check — does any Set exist in the given array of cards?
 * Short-circuits on first match.
 * @param {object[]} cards
 * @returns {boolean}
 */
export function hasSet(cards) {
  for (const triplet of triplets(cards)) {
    if (isSet(...triplet)) return true;
  }
  return false;
}
