/**
 * deck.js — Card data model, deck generation, and shuffle.
 *
 * A card is a plain object: { color, shape, count, fill }
 * The full deck has 81 unique cards (3^4 combinations).
 */

const COLORS  = ['red', 'green', 'purple'];
const SHAPES  = ['oval', 'diamond', 'squiggle'];
const COUNTS  = [1, 2, 3];
const FILLS   = ['solid', 'striped', 'open'];

/**
 * Generate all 81 unique Set cards.
 * @returns {Array<{color: string, shape: string, count: number, fill: string}>}
 */
export function createDeck() {
  const deck = [];
  for (const color of COLORS) {
    for (const shape of SHAPES) {
      for (const count of COUNTS) {
        for (const fill of FILLS) {
          deck.push({ color, shape, count, fill });
        }
      }
    }
  }
  return deck;
}

/**
 * Return the word with an 's' appended when n !== 1.
 * @param {number} n
 * @param {string} word
 * @returns {string}
 */
export const pluralize = (n, word) => word + (n !== 1 ? 's' : '');

/**
 * Fisher-Yates shuffle — returns a new shuffled array, does not mutate input.
 * @param {any[]} array
 * @returns {any[]}
 */
export function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
