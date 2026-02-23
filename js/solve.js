/**
 * solve.js — Board builder and Set solver for solve.html
 *
 * The card picker shows all 81 cards. Clicking a picker card toggles it
 * onto/off the board. The board can also be populated with a random deal.
 * "Find All Sets" runs findAllSets() on the current board and renders results.
 */

import { createDeck, shuffle, pluralize } from './deck.js';
import { findAllSets } from './set-logic.js';
import { createCardEl, renderSetList } from './card-render.js';

// ── DOM References ───────────────────────────────────────────
const solveBoardEl   = document.getElementById('solve-board');
const boardCountEl   = document.getElementById('board-count');
const boardEmptyMsg  = document.getElementById('board-empty-msg');
const cardPickerEl   = document.getElementById('card-picker');
const btnRandom      = document.getElementById('btn-random');
const btnFindSets    = document.getElementById('btn-find-sets');
const btnClearBoard  = document.getElementById('btn-clear-board');
const resultsArea    = document.getElementById('results-area');
const resultsLabel   = document.getElementById('results-label');
const setsResultList = document.getElementById('sets-result-list');

// ── State ────────────────────────────────────────────────────
/** All 81 cards in a stable canonical order */
const allCards = createDeck();

/**
 * Set of indices (into allCards) currently on the board.
 * Using a Set preserves uniqueness without extra logic.
 */
const boardIndices = new Set();

// ── Event wiring helper ───────────────────────────────────────
/**
 * Attach pointer and keyboard activation listeners to a card element.
 * @param {HTMLElement} el
 * @param {Function} handler  Called with no arguments on activation.
 */
function addCardListeners(el, handler) {
  el.addEventListener('pointerdown', e => { e.preventDefault(); handler(); });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
  });
}

// ── Build the card picker ─────────────────────────────────────
function buildPicker() {
  cardPickerEl.innerHTML = '';
  allCards.forEach((card, idx) => {
    const el = createCardEl(card);
    el.setAttribute('role', 'listitem');
    el.dataset.deckIdx = idx;
    addCardListeners(el, () => toggleCardOnBoard(idx));
    cardPickerEl.appendChild(el);
  });
}

// ── Board management ──────────────────────────────────────────
function toggleCardOnBoard(deckIdx) {
  if (boardIndices.has(deckIdx)) {
    boardIndices.delete(deckIdx);
  } else {
    boardIndices.add(deckIdx);
  }
  syncBoardUI();
}

function renderBoard() {
  solveBoardEl.innerHTML = '';

  if (boardIndices.size === 0) {
    boardEmptyMsg.style.display = '';
    solveBoardEl.appendChild(boardEmptyMsg);
    boardCountEl.textContent = '(0 cards)';
    return;
  }

  boardEmptyMsg.style.display = 'none';
  boardCountEl.textContent = `(${boardIndices.size} ${pluralize(boardIndices.size, 'card')})`;

  for (const idx of [...boardIndices].sort((a, b) => a - b)) {
    const card = allCards[idx];
    const el = createCardEl(card);
    addCardListeners(el, () => toggleCardOnBoard(idx));
    solveBoardEl.appendChild(el);
  }
}

function updatePickerHighlights() {
  for (const el of cardPickerEl.children) {
    const idx = Number(el.dataset.deckIdx);
    el.classList.toggle('on-board', boardIndices.has(idx));
    el.setAttribute('aria-pressed', boardIndices.has(idx) ? 'true' : 'false');
  }
}

function clearBoard() {
  boardIndices.clear();
  syncBoardUI();
}

function dealRandom() {
  boardIndices.clear();
  const shuffled = shuffle([...Array(81).keys()]); // shuffle indices 0–80
  for (let i = 0; i < Math.min(12, shuffled.length); i++) {
    boardIndices.add(shuffled[i]);
  }
  syncBoardUI();
}

// ── Set finder ────────────────────────────────────────────────
function findAndDisplaySets() {
  const boardCards = [...boardIndices].map(i => allCards[i]);
  const sets = findAllSets(boardCards);

  setsResultList.innerHTML = '';
  resultsLabel.style.display = '';

  if (sets.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'no-sets-msg';
    msg.textContent = boardCards.length < 3
      ? 'Add at least 3 cards to the board to search for Sets.'
      : 'No Sets found in the current board.';
    setsResultList.appendChild(msg);
    return;
  }

  renderSetList(sets, setsResultList);
}

function clearResults() {
  resultsLabel.style.display = 'none';
  setsResultList.innerHTML = '';
}

/** Sync all board-dependent UI after any change to boardIndices. */
function syncBoardUI() {
  renderBoard();
  updatePickerHighlights();
  clearResults();
}

// ── Event Wiring ──────────────────────────────────────────────
btnRandom.addEventListener('click', dealRandom);
btnFindSets.addEventListener('click', findAndDisplaySets);
btnClearBoard.addEventListener('click', clearBoard);

// ── Init ──────────────────────────────────────────────────────
buildPicker();
renderBoard();
