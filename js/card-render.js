/**
 * card-render.js — DOM card creation helpers.
 *
 * Renders cards using <use href="#shape"> referencing the inline
 * <svg><defs> block present in each HTML page.
 * No event listeners are attached here — purely DOM construction.
 */

import { pluralize } from './deck.js';

/** Hex color values — read from CSS custom properties so style.css is the single source of truth. */
const _cs = getComputedStyle(document.documentElement);
const COLOR_HEX = {
  red:    _cs.getPropertyValue('--color-red').trim(),
  green:  _cs.getPropertyValue('--color-green').trim(),
  purple: _cs.getPropertyValue('--color-purple').trim(),
};

/**
 * Build the SVG fill/stroke attributes for a given card's color and fill.
 * @param {string} color  - 'red' | 'green' | 'purple'
 * @param {string} fill   - 'solid' | 'striped' | 'open'
 * @returns {{ fill: string, stroke: string, strokeWidth: string }}
 */
function shapeAttrs(color, fill) {
  const hex = COLOR_HEX[color];
  if (fill === 'solid') {
    return { fill: hex,                      stroke: hex, strokeWidth: '0.2' };
  }
  if (fill === 'striped') {
    return { fill: `url(#hatch-${color})`,   stroke: hex, strokeWidth: '0.5' };
  }
  // open
  return { fill: 'none',                     stroke: hex, strokeWidth: '0.5' };
}

/**
 * Build a human-readable ARIA label for a card.
 * Format: "{count} {color} {fill} {shape}[s]"
 * @param {object} card
 * @returns {string}
 */
function ariaLabel(card) {
  return `${card.count} ${card.color} ${card.fill} ${pluralize(card.count, card.shape)}`;
}

/**
 * Create a card DOM element.
 *
 * The returned element has:
 *   - class "card"
 *   - data-color, data-shape, data-count, data-fill attributes
 *   - aria-label
 *   - role="button" and tabindex="0" for keyboard accessibility
 *   - One <svg> per symbol (count determines how many)
 *
 * @param {object} card - { color, shape, count, fill }
 * @returns {HTMLElement}
 */
/**
 * Render a list of Set triplets into a container element.
 * Appends one set-result-item per triplet (does not clear the container first).
 * @param {Array<Array>} sets        - Array of card triplets from findAllSets()
 * @param {HTMLElement}  containerEl - Element to append items into
 */
export function renderSetList(sets, containerEl) {
  sets.forEach((triplet, i) => {
    const item = document.createElement('div');
    item.className = 'set-result-item';

    const label = document.createElement('div');
    label.className = 'set-number';
    label.textContent = `Set ${i + 1} of ${sets.length}`;
    item.appendChild(label);

    const cardsRow = document.createElement('div');
    cardsRow.className = 'set-result-cards';
    for (const card of triplet) {
      cardsRow.appendChild(createCardEl(card));
    }
    item.appendChild(cardsRow);
    containerEl.appendChild(item);
  });
}

export function createCardEl(card) {
  const div = document.createElement('div');
  div.className = 'card';
  div.setAttribute('role', 'button');
  div.setAttribute('tabindex', '0');
  div.setAttribute('aria-label', ariaLabel(card));
  div.dataset.color = card.color;
  div.dataset.shape = card.shape;
  div.dataset.count = String(card.count);
  div.dataset.fill  = card.fill;

  const attrs = shapeAttrs(card.color, card.fill);

  for (let i = 0; i < card.count; i++) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 12 8');
    svg.setAttribute('aria-hidden', 'true');

    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${card.shape}`);
    use.setAttribute('fill', attrs.fill);
    use.setAttribute('stroke', attrs.stroke);
    use.setAttribute('stroke-width', attrs.strokeWidth);

    svg.appendChild(use);
    div.appendChild(svg);
  }

  return div;
}
