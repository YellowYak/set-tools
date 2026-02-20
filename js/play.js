/**
 * play.js — Game loop for play.html
 *
 * State:
 *   deck     — remaining undealt cards
 *   board    — cards currently visible (parallel array to DOM children of #board)
 *   selected — indices (into board) of currently selected cards (max 3)
 *   scores   — array of player scores (currently single player)
 *   busy     — true while an animation is running (blocks new selections)
 */

import { createDeck, shuffle, pluralize } from './deck.js';
import { isSet, findAllSets, hasSet } from './set-logic.js';
import { createCardEl } from './card-render.js';

// ── DOM References ──────────────────────────────────────────
const boardEl       = document.getElementById('board');
const scoreP1El     = document.getElementById('score-p1');
const scoreCardEl   = document.querySelector('.score-card');
const statusEl      = document.getElementById('game-status');
const btnNewGame    = document.getElementById('btn-new-game');
const btnHint       = document.getElementById('btn-hint');
const modalOverlay   = document.getElementById('modal-overlay');
const modalScores    = document.getElementById('modal-scores');
const btnPlayAgain   = document.getElementById('btn-play-again');
const btnShowSets    = document.getElementById('btn-show-sets');
const setsOverlay    = document.getElementById('sets-overlay');
const setsOverlayList = document.getElementById('sets-overlay-list');
const btnCloseSets   = document.getElementById('btn-close-sets');
const timerDisplayEl = document.getElementById('timer-display');

// ── Game State ──────────────────────────────────────────────
let deck     = [];
let board    = [];   // card objects on the board
let selected = [];   // indices into board[]
let scores   = [0];  // one entry per player
let busy     = false;

// Hint state
// hintStep:       how many of the hint set's cards have been revealed (0–3)
// hintSetIndices: the three board indices of the chosen hint set
let hintStep       = 0;
let hintSetIndices = null;

// Timer state
let timerStart    = 0;    // Date.now() when current game began
let timerInterval = null; // setInterval handle, null when stopped
let finalTimeStr  = '0:00'; // frozen display value after game ends
let lastSetTime   = 0;    // Date.now() at game start or last Set completion
let setTimes      = [];   // ms elapsed for each successfully found Set

// ── Initialisation ──────────────────────────────────────────
function initGame() {
  resetHint();
  deck     = shuffle(createDeck());
  board    = [];
  selected = [];
  scores   = [0];
  busy     = false;

  boardEl.innerHTML = '';
  updateScoreDisplay();
  modalOverlay.classList.add('hidden');

  // Deal initial 12 cards, then ensure a Set exists (silent — no toast at start).
  dealCards(12, 0);
  ensureSetOnBoard(null, false);
  updateStatus();
  startTimer();
}

// ── Helpers ──────────────────────────────────────────────────
/** Returns a random rotation between -2 and +2 degrees (2 decimal places). */
function randomRotation() {
  return (Math.random() * 4 - 2).toFixed(2) + 'deg';
}

// ── Dealing ─────────────────────────────────────────────────
/**
 * Deal n cards from the deck onto the board.
 * @param {number} n
 * @param {number} startDelayMs  Animation delay for the first card; each subsequent card adds 80ms.
 */
function dealCards(n, startDelayMs = 0) {
  const toDeal = Math.min(n, deck.length);
  for (let i = 0; i < toDeal; i++) {
    const card = deck.pop();
    board.push(card);
    const el = createCardEl(card);
    el.style.setProperty('--card-rotate', randomRotation());
    el.addEventListener('pointerdown', onCardPointerDown);
    el.addEventListener('keydown', onCardKeyDown);
    dealInCard(el, startDelayMs + i * 80);
    boardEl.appendChild(el);
  }
}

/**
 * Replace card at board index with a new card from the deck (if available).
 * @param {number} boardIndex
 * @param {number} delayMs  Deal-in animation delay.
 * @returns {boolean}
 */
function replaceCard(boardIndex, delayMs = 0) {
  if (deck.length === 0) return false;
  const card = deck.pop();
  board[boardIndex] = card;
  const el = createCardEl(card);
  el.style.setProperty('--card-rotate', randomRotation());
  el.addEventListener('pointerdown', onCardPointerDown);
  el.addEventListener('keydown', onCardKeyDown);
  dealInCard(el, delayMs);
  boardEl.children[boardIndex].replaceWith(el);
  return true;
}

/** Remove cards at given board indices (high to low to preserve lower indices). */
function removeCards(indices) {
  const sorted = [...indices].sort((a, b) => b - a);
  for (const idx of sorted) {
    board.splice(idx, 1);
    boardEl.children[idx].remove();
  }
}

// ── Board Management ────────────────────────────────────────
/**
 * Ensure there is at least one Set on the board.
 * If notify is true (gameplay), shows a toast and waits 2s before each batch
 * of 3 extra cards so the player understands why the board grew.
 * If notify is false (game init), deals synchronously with no toast.
 * @param {Function|null} onDone  Called when a Set is present or deck is empty.
 * @param {boolean}       notify  Whether to show a toast and pause before dealing.
 */
function ensureSetOnBoard(onDone = null, notify = true) {
  if (hasSet(board) || deck.length === 0) {
    onDone?.();
    return;
  }
  if (!notify) {
    // Silent synchronous path used during game initialisation.
    dealCards(3, 0);
    ensureSetOnBoard(onDone, false);
    return;
  }
  // Notify path: pause so the player can read the toast before cards appear.
  showToast('No sets on the board — adding 3 more cards…', 2200);
  setTimeout(() => {
    dealCards(3, 0);
    ensureSetOnBoard(onDone, true);
  }, 2000);
}

// ── Selection & Validation ──────────────────────────────────
function onCardPointerDown(e) {
  e.preventDefault(); // prevent mouse event double-fire on touch
  if (busy) return;
  const el = e.currentTarget;
  const idx = indexOfEl(el);
  if (idx === -1) return;
  toggleSelect(idx);
}

function onCardKeyDown(e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (busy) return;
    const idx = indexOfEl(e.currentTarget);
    if (idx !== -1) toggleSelect(idx);
  }
}

function indexOfEl(el) {
  return Array.from(boardEl.children).indexOf(el);
}

function toggleSelect(idx) {
  const pos = selected.indexOf(idx);
  if (pos !== -1) {
    // Deselect
    selected.splice(pos, 1);
    boardEl.children[idx].classList.remove('selected');
    return;
  }
  if (selected.length >= 3) return; // already have 3 pending

  selected.push(idx);
  boardEl.children[idx].classList.add('selected');

  if (selected.length === 3) {
    validateSelection();
  }
}

function validateSelection() {
  const [i, j, k] = selected;
  const cards = [board[i], board[j], board[k]];
  const els   = [boardEl.children[i], boardEl.children[j], boardEl.children[k]];

  if (isSet(...cards)) {
    handleSuccess(els, [i, j, k]);
  } else {
    handleError(els);
  }
}

// ── Success ─────────────────────────────────────────────────
function handleSuccess(els, indices) {
  const now = Date.now();
  setTimes.push(now - lastSetTime);
  lastSetTime = now;
  busy = true;
  resetHint();
  showToast('That\'s a Set!', 2200);

  for (const el of els) el.classList.remove('selected');

  scores[0]++;
  updateScoreDisplay();

  flyCardsToScore(els, () => {
    // If the board has more than 12 cards (extras were added), just remove
    // the matched cards without replacement; otherwise replace them.
    const shouldReplace = board.length <= 12 && deck.length >= 3;

    if (shouldReplace) {
      // Replace in-place high→low so lower indices stay stable.
      // Stagger deal-in delays to match the 3 replacement slots.
      const sorted = [...indices].map((idx, i) => ({ idx, i }))
                                 .sort((a, b) => b.idx - a.idx);
      for (const { idx, i } of sorted) {
        replaceCard(idx, i * 70);
      }
    } else {
      removeCards(indices);
    }

    selected = [];

    ensureSetOnBoard(() => {
      busy = false;
      updateStatus();
      checkGameOver();
    });
  });
}

// ── Fly-to-Score Animation ────────────────────────────────────
/**
 * Clone the matched card elements, fly them to the score panel, then call onComplete.
 * The originals are made invisible (but hold grid space) during the flight.
 * @param {Element[]} els        The 3 matched card DOM elements.
 * @param {Function}  onComplete Called after the animation finishes.
 */
function flyCardsToScore(els, onComplete) {
  const targetRect = scoreCardEl.getBoundingClientRect();
  const targetCX   = targetRect.left + targetRect.width  / 2;
  const targetCY   = targetRect.top  + targetRect.height / 2;

  // Stagger: last clone lands at t = FLY_STAGGER * 2 + FLY_DURATION
  const FLY_DURATION = 350; // ms, CSS transition duration per clone
  const FLY_STAGGER  = 70;  // ms between each clone launch
  const TOTAL_MS     = FLY_STAGGER * (els.length - 1) + FLY_DURATION + 40;

  els.forEach((el, i) => {
    // Snapshot position and clone BEFORE hiding the original so the
    // clone doesn't inherit the .flying class (which sets opacity: 0).
    const cardRect = el.getBoundingClientRect();
    const cardCX   = cardRect.left + cardRect.width  / 2;
    const cardCY   = cardRect.top  + cardRect.height / 2;

    const clone = el.cloneNode(true);
    const rotation = el.style.getPropertyValue('--card-rotate');

    // Hide original now (after cloning) — keeps grid space intact
    el.classList.add('flying');
    clone.style.cssText = `
      position: fixed;
      left: ${cardRect.left}px;
      top:  ${cardRect.top}px;
      width:  ${cardRect.width}px;
      height: ${cardRect.height}px;
      margin: 0;
      z-index: 50;
      pointer-events: none;
      transition: transform ${FLY_DURATION}ms ease-in ${i * FLY_STAGGER}ms,
                  opacity   ${FLY_DURATION}ms ease-in ${i * FLY_STAGGER}ms;
    `;
    if (rotation) clone.style.setProperty('--card-rotate', rotation);
    document.body.appendChild(clone);

    // Double-RAF: first lets the browser register the element at its start
    // position; second triggers the transition to the target position.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const dx = targetCX - cardCX;
        const dy = targetCY - cardCY;
        clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.15)`;
        clone.style.opacity   = '0';
      });
    });

    // Clean up clone after its individual flight completes
    const cloneRemoveAt = FLY_STAGGER * i + FLY_DURATION + 20;
    setTimeout(() => clone.remove(), cloneRemoveAt);
  });

  // Pulse the score panel as the last clone arrives
  const pulseAt = FLY_STAGGER * (els.length - 1) + FLY_DURATION - 60;
  setTimeout(() => {
    scoreCardEl.classList.add('score-pulse');
    scoreCardEl.addEventListener('animationend', () => {
      scoreCardEl.classList.remove('score-pulse');
    }, { once: true });
  }, pulseAt);

  setTimeout(onComplete, TOTAL_MS);
}

// ── Deal-In Animation ─────────────────────────────────────────
/**
 * Apply the deal-in CSS animation to a card element.
 * @param {Element} el
 * @param {number}  delayMs
 */
function dealInCard(el, delayMs) {
  el.style.animationDelay = `${delayMs}ms`;
  el.classList.add('dealing');
  el.addEventListener('animationend', () => {
    el.classList.remove('dealing');
    el.style.animationDelay = '';
  }, { once: true });
}

// ── Error ────────────────────────────────────────────────────
function handleError(els) {
  busy = true;
  showToast('Not a Set — try again.', 2200);

  for (const el of els) {
    el.classList.remove('selected');
    el.classList.add('flash-error');
  }

  setTimeout(() => {
    for (const el of els) {
      el.classList.remove('flash-error');
    }
    selected = [];
    busy = false;
  }, 650);
}

// ── Toast ─────────────────────────────────────────────────────
let toastContainer = null;

/**
 * Display a brief toast message at the bottom of the screen.
 * @param {string} message
 * @param {number} duration  ms before the toast fades out
 */
function showToast(message, duration = 2800) {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hiding');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

// ── Hint ─────────────────────────────────────────────────────
/**
 * Progressive hint: each click reveals one more card from the same Set.
 *   Step 0 → 1: pick a Set, highlight card 1
 *   Step 1 → 2: highlight card 2
 *   Step 2 → 3: highlight card 3
 *   Step 3    : show "all highlighted" message, no further changes
 * Resets automatically when the player completes a Set or starts a new game.
 */
function showHint() {
  if (busy) return;

  if (hintStep === 0) {
    // Choose a Set to hint at
    const sets = findAllSets(board);
    if (sets.length === 0) return;
    const [a, b, c] = sets[0];
    hintSetIndices = [board.indexOf(a), board.indexOf(b), board.indexOf(c)];
  }

  if (hintStep < 3) {
    const idx = hintSetIndices[hintStep];
    boardEl.children[idx]?.classList.add('hint');
    hintStep++;

    const remaining = 3 - hintStep;
    showToast(remaining > 0
      ? `${remaining} ${pluralize(remaining, 'card')} still hidden — click Hint again`
      : 'All three cards of the Set are highlighted.');
  } else {
    showToast('All three cards of the Set are highlighted.');
  }
}

/** Clear all hint highlights and reset hint state. */
function resetHint() {
  hintStep       = 0;
  hintSetIndices = null;
  for (const el of boardEl.querySelectorAll('.hint')) {
    el.classList.remove('hint');
  }
}

// ── Game Over ────────────────────────────────────────────────
function checkGameOver() {
  if (deck.length === 0 && !hasSet(board)) {
    showGameOver();
  }
}

function showGameOver() {
  stopTimer();
  modalScores.innerHTML = '';

  const scoreRow = document.createElement('div');
  scoreRow.className = 'final-score-row';
  scoreRow.innerHTML = `<span class="winner-label">Player 1</span><span>${scores[0]} ${pluralize(scores[0], 'Set')}</span>`;
  modalScores.appendChild(scoreRow);

  const timeRow = document.createElement('div');
  timeRow.className = 'final-score-row';
  timeRow.innerHTML = `<span class="winner-label">Time</span><span>${finalTimeStr}</span>`;
  modalScores.appendChild(timeRow);

  if (setTimes.length > 0) {
    const avgMs     = setTimes.reduce((a, b) => a + b, 0) / setTimes.length;
    const fastestMs = Math.min(...setTimes);

    const label = document.createElement('p');
    label.className = 'set-times-label';
    label.textContent = 'Set Times';
    modalScores.appendChild(label);

    const list = document.createElement('div');
    list.className = 'set-times-breakdown';
    setTimes.forEach((ms, i) => {
      const row = document.createElement('div');
      row.className = 'set-time-row';
      row.innerHTML = `<span>Set ${i + 1}</span><span>${formatTime(ms)}</span>`;
      list.appendChild(row);
    });
    modalScores.appendChild(list);

    const avgRow = document.createElement('div');
    avgRow.className = 'final-score-row';
    avgRow.innerHTML = `<span class="winner-label">Avg / Set</span><span>${formatTime(avgMs)}</span>`;
    modalScores.appendChild(avgRow);

    const fastRow = document.createElement('div');
    fastRow.className = 'final-score-row';
    fastRow.innerHTML = `<span class="winner-label">Fastest</span><span>${formatTime(fastestMs)}</span>`;
    modalScores.appendChild(fastRow);
  }

  modalOverlay.classList.remove('hidden');
}

// ── UI Updates ────────────────────────────────────────────────
function updateScoreDisplay() {
  scoreP1El.textContent = scores[0];
}

function updateStatus() {
  const remaining = deck.length;
  const onBoard   = board.length;
  const setCount  = findAllSets(board).length;
  statusEl.textContent = `${remaining} ${pluralize(remaining, 'card')} left · ${onBoard} on board · ${setCount} ${pluralize(setCount, 'set')} present`;
}

// ── Timer ─────────────────────────────────────────────────────
function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function startTimer() {
  clearInterval(timerInterval);
  timerStart = Date.now();
  lastSetTime = timerStart;
  setTimes = [];
  timerDisplayEl.textContent = '0:00';
  timerInterval = setInterval(() => {
    timerDisplayEl.textContent = formatTime(Date.now() - timerStart);
  }, 1000);
}

function stopTimer() {
  finalTimeStr = formatTime(Date.now() - timerStart);
  timerDisplayEl.textContent = finalTimeStr;
  clearInterval(timerInterval);
  timerInterval = null;
}

// ── All Sets Overlay ──────────────────────────────────────────
function showSetsOverlay() {
  const sets = findAllSets(board);
  setsOverlayList.innerHTML = '';

  if (sets.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'no-sets-msg';
    msg.textContent = 'No Sets on the current board.';
    setsOverlayList.appendChild(msg);
  } else {
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
      setsOverlayList.appendChild(item);
    });
  }

  setsOverlay.classList.remove('hidden');
}

function closeSetsOverlay() {
  setsOverlay.classList.add('hidden');
}

// ── Event Wiring ─────────────────────────────────────────────
btnNewGame.addEventListener('click', initGame);
btnPlayAgain.addEventListener('click', initGame);
btnHint.addEventListener('click', showHint);
btnShowSets.addEventListener('click', showSetsOverlay);
btnCloseSets.addEventListener('click', closeSetsOverlay);
setsOverlay.addEventListener('pointerdown', e => {
  if (e.target === setsOverlay) closeSetsOverlay();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !setsOverlay.classList.contains('hidden')) closeSetsOverlay();
});

// ── Start ────────────────────────────────────────────────────
initGame();
