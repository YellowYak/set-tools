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
import { randomRotation } from './utils.js';
import { recognizeCards } from './image-recognize.js';

// ── DOM References ───────────────────────────────────────────
const solveBoardEl      = document.getElementById('solve-board');
const boardCountEl      = document.getElementById('board-count');
const boardEmptyMsg     = document.getElementById('board-empty-msg');
const cardPickerEl      = document.getElementById('card-picker');
const btnRandom         = document.getElementById('btn-random');
const btnFindSets       = document.getElementById('btn-find-sets');
const btnClearBoard     = document.getElementById('btn-clear-board');
const resultsLabel      = document.getElementById('results-label');
const setsResultList    = document.getElementById('sets-result-list');
// Scan-photo UI
const btnScanPhoto      = document.getElementById('btn-scan-photo');
const scanFileInput     = document.getElementById('scan-file-input');
const scanModalOverlay  = document.getElementById('scan-modal-overlay');
const scanStatus        = document.getElementById('scan-status');
const scanPreviewCanvas = document.getElementById('scan-preview-canvas');
const scanCardPreview   = document.getElementById('scan-card-preview');
const btnScanConfirm    = document.getElementById('btn-scan-confirm');
const btnScanCancel     = document.getElementById('btn-scan-cancel');

// ── State ────────────────────────────────────────────────────
/** All 81 cards in a stable canonical order */
const allCards = createDeck();

/**
 * Set of indices (into allCards) currently on the board.
 * Using a Set preserves uniqueness without extra logic.
 */
const boardIndices = new Set();

/** Standard number of cards on the board (fewer only when the deck runs short). */
const BOARD_SIZE = 12;

/** Whether the sets results panel is currently visible. */
let setsVisible = false;

/** Cached rotation per deck index so cards don't re-tilt on every board re-render. */
const cardRotations = new Map();

/** Cached findAllSets() result for the current board. Recomputed in syncBoardUI. */
let cachedSets = [];

/** Deck indices from the most recent scan, waiting for user confirmation. */
let pendingScanIndices = [];

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

// ── Card picker ───────────────────────────────────────────────
function renderPicker() {
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
    boardEmptyMsg.classList.remove('hidden');
    solveBoardEl.appendChild(boardEmptyMsg);
    boardCountEl.textContent = '(0 cards)';
    return;
  }

  boardEmptyMsg.classList.add('hidden');
  boardCountEl.textContent = `(${boardIndices.size} ${pluralize(boardIndices.size, 'card')})`;

  // Cards render in insertion order (the order the user picked them).
  // JS Set preserves insertion order, giving a stable, predictable display.
  for (const idx of boardIndices) {
    const card = allCards[idx];
    const el = createCardEl(card);
    if (!cardRotations.has(idx)) cardRotations.set(idx, randomRotation());
    el.style.setProperty('--card-rotate', cardRotations.get(idx));
    addCardListeners(el, () => toggleCardOnBoard(idx));
    solveBoardEl.appendChild(el);
  }
}

function updatePickerHighlights() {
  for (const el of cardPickerEl.children) {
    const idx = Number(el.dataset.deckIdx);
    const isOnBoard = boardIndices.has(idx);
    el.classList.toggle('on-board', isOnBoard);
    el.setAttribute('aria-pressed', isOnBoard ? 'true' : 'false');
  }
}

function clearBoard() {
  boardIndices.clear();
  cardRotations.clear();
  setsVisible = false;
  syncBoardUI();
}

function dealRandom() {
  boardIndices.clear();
  cardRotations.clear();
  const shuffled = shuffle([...Array(allCards.length).keys()]);
  for (let i = 0; i < Math.min(BOARD_SIZE, shuffled.length); i++) {
    boardIndices.add(shuffled[i]);
  }
  syncBoardUI();
}

// ── Set finder ────────────────────────────────────────────────
/** Renders the current sets into the results panel. Does not change setsVisible. */
function renderSets() {
  const sets = cachedSets; // already computed by syncBoardUI before renderSets is called

  setsResultList.innerHTML = '';
  resultsLabel.classList.remove('hidden');
  btnFindSets.textContent = 'Hide Sets';

  if (sets.length === 0) {
    resultsLabel.textContent = 'No Sets Found';
    const msg = document.createElement('p');
    msg.className = 'no-sets-msg';
    msg.textContent = boardIndices.size < 3
      ? 'Add at least 3 cards to the board to search for Sets.'
      : 'No Sets found in the current board.';
    setsResultList.appendChild(msg);
    return;
  }

  resultsLabel.textContent = `Sets Found (${sets.length})`;
  renderSetList(sets, setsResultList);
}

function clearResults() {
  resultsLabel.classList.add('hidden');
  setsResultList.innerHTML = '';
}

// ── URL / deep-link sync ──────────────────────────────────────
function syncQueryString() {
  if (boardIndices.size === 0) {
    history.replaceState(null, '', location.pathname);
  } else {
    const params = new URLSearchParams({ cards: [...boardIndices].join(',') });
    history.replaceState(null, '', `${location.pathname}?${params}`);
  }
}

function loadFromQueryString() {
  const cardsParam = new URLSearchParams(location.search).get('cards');
  if (!cardsParam) return;

  const indices = cardsParam.split(',')
    .map(s => parseInt(s, 10))
    .filter(n => Number.isInteger(n) && n >= 0 && n < allCards.length);

  for (const idx of indices) boardIndices.add(idx);

  if (boardIndices.size > 0) {
    // Auto-reveal sets when arriving via a shared or bookmarked link — the page
    // is a solver, so showing answers immediately is the expected behaviour.
    setsVisible = true;
  }
}

/** Sync all board-dependent UI after any change to boardIndices. */
function syncBoardUI() {
  cachedSets = findAllSets([...boardIndices].map(i => allCards[i]));
  renderBoard();
  updatePickerHighlights();
  syncQueryString();

  if (setsVisible) {
    renderSets();
  } else {
    clearResults();
    btnFindSets.textContent = `Reveal Sets (${cachedSets.length})`;
  }
}

// ── Scan flow ─────────────────────────────────────────────────
function closeScanModal() {
  scanModalOverlay.classList.add('hidden');
  pendingScanIndices = [];
}

async function startScan(file) {
  // Reset modal to loading state
  pendingScanIndices = [];
  scanStatus.textContent = '';
  scanCardPreview.innerHTML = '';
  btnScanConfirm.disabled = true;
  // Clear any previous preview image
  scanPreviewCanvas.removeAttribute('width');
  scanPreviewCanvas.removeAttribute('height');

  scanModalOverlay.classList.remove('hidden');

  try {
    const { deckIndices, previewCanvas } = await recognizeCards(
      file,
      allCards,
      msg => { scanStatus.textContent = msg; }
    );

    // Render annotated preview image
    scanPreviewCanvas.width  = previewCanvas.width;
    scanPreviewCanvas.height = previewCanvas.height;
    scanPreviewCanvas.getContext('2d').drawImage(previewCanvas, 0, 0);

    // Deduplicate and filter out unrecognized cards (-1)
    const validIndices = [...new Set(deckIndices.filter(i => i >= 0))];
    pendingScanIndices = validIndices;

    // Show recognized cards as small card elements
    scanCardPreview.innerHTML = '';
    for (const idx of validIndices) {
      const el = createCardEl(allCards[idx]);
      el.setAttribute('role', 'listitem');
      scanCardPreview.appendChild(el);
    }

    const rejected = deckIndices.length - validIndices.length;
    const countStr = `${validIndices.length} card${validIndices.length !== 1 ? 's' : ''} found`;
    const rejectStr = rejected > 0 ? ` (${rejected} skipped — unrecognized or duplicate)` : '';
    scanStatus.textContent = validIndices.length === 0
      ? 'No cards detected. Try a clearer photo.'
      : countStr + rejectStr + '.';

    btnScanConfirm.disabled = validIndices.length === 0;

  } catch (err) {
    console.error('[solve] Scan failed:', err);
    scanStatus.textContent = `Error: ${err.message}`;
    btnScanConfirm.disabled = true;
  }
}

// ── Event Wiring ──────────────────────────────────────────────
btnRandom.addEventListener('click', dealRandom);
btnFindSets.addEventListener('click', () => {
  setsVisible = !setsVisible;
  if (setsVisible) {
    renderSets();
  } else {
    clearResults();
    btnFindSets.textContent = `Reveal Sets (${cachedSets.length})`;
  }
});
btnClearBoard.addEventListener('click', clearBoard);

// Scan photo wiring
btnScanPhoto.addEventListener('click', () => scanFileInput.click());

scanFileInput.addEventListener('change', () => {
  const file = scanFileInput.files[0];
  if (!file) return;
  scanFileInput.value = ''; // reset so re-selecting the same file triggers change again
  startScan(file);
});

btnScanConfirm.addEventListener('click', () => {
  boardIndices.clear();
  cardRotations.clear();
  setsVisible = false;
  for (const idx of pendingScanIndices) boardIndices.add(idx);
  closeScanModal();
  syncBoardUI();
});

btnScanCancel.addEventListener('click', closeScanModal);

scanModalOverlay.addEventListener('pointerdown', e => {
  if (e.target === scanModalOverlay) closeScanModal();
});

// ── Init ──────────────────────────────────────────────────────
renderPicker();
loadFromQueryString();
syncBoardUI();
