/**
 * play.js — Game loop for play.html
 *
 * State:
 *   deck             — remaining undealt cards
 *   board            — cards currently visible (parallel array to DOM children of #board)
 *   selected         — indices (into board) of currently selected cards (max 3)
 *   score            — player 1's sets found
 *   busy             — true while an animation is running (blocks new selections)
 *   gameMode         — 'solo' | 'vs-computer'
 *   difficulty       — 'easy' | 'medium' | 'hard' | 'genius'
 *   computerScore    — sets found by the computer
 *   computerTimerHandle — setTimeout handle for the computer's next move
 */

import { createDeck, shuffle, pluralize } from './deck.js';
import { isSet, findAllSets, hasSet } from './set-logic.js';
import { createCardEl, renderSetList } from './card-render.js';

// ── DOM References ──────────────────────────────────────────
const boardEl            = document.getElementById('board');
const scoreP1El          = document.getElementById('score-p1');
const scoreCardEl        = document.getElementById('score-p1-card');
const scoreComputerCardEl = document.getElementById('score-computer-card');
const scoreComputerEl    = document.getElementById('score-computer');
const statusEl           = document.getElementById('game-status');
const btnNewGame         = document.getElementById('btn-new-game');
const btnHint            = document.getElementById('btn-hint');
const modalOverlay       = document.getElementById('modal-overlay');
const modalScores        = document.getElementById('modal-scores');
const btnPlayAgain       = document.getElementById('btn-play-again');
const btnShowSets        = document.getElementById('btn-show-sets');
const setsOverlay        = document.getElementById('sets-overlay');
const setsOverlayList    = document.getElementById('sets-overlay-list');
const btnCloseSets       = document.getElementById('btn-close-sets');
const timerDisplayEl     = document.getElementById('timer-display');
const pauseOverlay       = document.getElementById('pause-overlay');
const btnPause           = document.getElementById('btn-pause');
const btnResume          = document.getElementById('btn-resume');
const modalMode          = document.getElementById('modal-mode');
const modalDifficulty    = document.getElementById('modal-difficulty');
const btnSolo            = document.getElementById('btn-solo');
const btnVsComputer      = document.getElementById('btn-vs-computer');
const btnBackToMode      = document.getElementById('btn-back-to-mode');

// ── Game State ──────────────────────────────────────────────
let deck     = [];
let board    = [];   // card objects on the board
let selected = [];   // indices into board[]
let score    = 0;
let busy     = false;

// Mode & computer state
let gameMode          = 'solo';    // 'solo' | 'vs-computer'
let difficulty        = 'medium';  // 'easy' | 'medium' | 'hard' | 'genius'
let computerScore     = 0;
let computerTimerHandle = null;

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

// Pause state
let paused                = false;
let pausedElapsed         = 0; // ms elapsed when paused
let computerTimerDeadline = 0; // Date.now() + delay when computer timer was scheduled
let computerPauseRemaining = 0; // ms left on computer timer when paused

// ── Difficulty Ranges (ms) ──────────────────────────────────
const DIFFICULTY_RANGES = {
  easy:   [10000, 30000],
  medium: [7500,  20000],
  hard:   [5000,  15000],
  genius: [2000,   8000],
};

// ── Mode Selection ───────────────────────────────────────────
function showModeModal() {
  modalOverlay.classList.add('hidden');
  modalDifficulty.classList.add('hidden');
  setsOverlay.classList.add('hidden');
  modalMode.classList.remove('hidden');
}

function showDifficultyModal() {
  modalMode.classList.add('hidden');
  modalDifficulty.classList.remove('hidden');
}

// ── Initialisation ──────────────────────────────────────────
function startGame() {
  resetHint();
  clearComputerTimer();
  deck          = shuffle(createDeck());
  board         = [];
  selected      = [];
  score         = 0;
  computerScore = 0;
  busy          = false;

  // Show or hide the computer score card based on mode
  scoreComputerCardEl.classList.toggle('hidden', gameMode !== 'vs-computer');
  document.getElementById('computer-difficulty').textContent =
    gameMode === 'vs-computer' ? difficulty : '';

  paused = false;
  pausedElapsed = 0;
  computerTimerDeadline = 0;
  computerPauseRemaining = 0;

  boardEl.innerHTML = '';
  updateScoreDisplay();
  pauseOverlay.classList.add('hidden');
  modalMode.classList.add('hidden');
  modalDifficulty.classList.add('hidden');
  modalOverlay.classList.add('hidden');

  // Deal initial 12 cards, then ensure a Set exists (silent — no toast at start).
  dealCards(12, 0);
  ensureSetOnBoard(null, false);
  updateStatus();
  startTimer();

  if (gameMode === 'vs-computer') {
    scheduleComputerMove();
  }
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

/**
 * After a Set is matched, replace the three slots in-place (if the board has
 * ≤12 cards and the deck has cards remaining) or simply remove them.
 * @param {number[]} indices  Three board indices of the matched cards.
 */
function replaceOrRemoveCards(indices) {
  if (board.length <= 12 && deck.length >= 3) {
    const sorted = [...indices].map((idx, i) => ({ idx, i }))
                               .sort((a, b) => b.idx - a.idx);
    for (const { idx, i } of sorted) replaceCard(idx, i * 70);
  } else {
    removeCards(indices);
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
  setTimeout(() => {
    showToast('No sets on the board — adding 3 more cards…');
    dealCards(3, 0);
    ensureSetOnBoard(onDone, true);
  }, 3000);
}

// ── Selection & Validation ──────────────────────────────────
function onCardPointerDown(e) {
  e.preventDefault(); // prevent mouse event double-fire on touch
  if (busy || paused) return;
  const el = e.currentTarget;
  const idx = indexOfEl(el);
  if (idx === -1) return;
  toggleSelect(idx);
}

function onCardKeyDown(e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (busy || paused) return;
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

  if (gameMode === 'vs-computer') {
    clearComputerTimer();
    showToast('You found a Set!', 2200);
  } else {
    showToast('That\'s a Set!', 2200);
  }

  for (const el of els) el.classList.remove('selected');

  score++;
  updateScoreDisplay();

  flyCardsToScore(els, scoreCardEl, () => {
    // If the board has more than 12 cards (extras were added), just remove
    // the matched cards without replacement; otherwise replace them.
    replaceOrRemoveCards(indices);

    selected = [];

    ensureSetOnBoard(() => {
      busy = false;
      updateStatus();
      if (!checkGameOver() && gameMode === 'vs-computer' && !paused) {
        scheduleComputerMove();
      }
    });
  });
}

// ── Fly-to-Score Animation ────────────────────────────────────
/**
 * Clone the matched card elements, fly them to a score card, then call onComplete.
 * The originals are made invisible (but hold grid space) during the flight.
 * @param {Element[]} els        The 3 matched card DOM elements.
 * @param {Element}   targetEl   The score card element to fly toward.
 * @param {Function}  onComplete Called after the animation finishes.
 */
function flyCardsToScore(els, targetEl, onComplete) {
  const targetRect = targetEl.getBoundingClientRect();
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

  // Pulse the target score card as the last clone arrives
  const pulseAt = FLY_STAGGER * (els.length - 1) + FLY_DURATION - 60;
  setTimeout(() => {
    targetEl.classList.add('score-pulse');
    targetEl.addEventListener('animationend', () => {
      targetEl.classList.remove('score-pulse');
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
  if (busy || paused) return;

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

// ── Computer AI ──────────────────────────────────────────────
function scheduleComputerMove() {
  clearComputerTimer();
  const [min, max] = DIFFICULTY_RANGES[difficulty];
  const delay = min + Math.random() * (max - min);
  computerTimerDeadline = Date.now() + delay;
  computerTimerHandle = setTimeout(computerTakesSet, delay);
}

function clearComputerTimer() {
  if (computerTimerHandle !== null) {
    clearTimeout(computerTimerHandle);
    computerTimerHandle = null;
  }
  computerTimerDeadline = 0;
}

function computerTakesSet() {
  if (busy) {
    // Animation in progress — retry shortly
    computerTimerHandle = setTimeout(computerTakesSet, 300);
    return;
  }

  const sets = findAllSets(board);
  if (sets.length === 0) return; // checkGameOver handles the no-set case

  busy = true;

  // Clear any partial player selection
  selected.forEach(i => boardEl.children[i]?.classList.remove('selected'));
  selected = [];
  resetHint();

  const [a, b, c] = sets[0];
  const indices = [board.indexOf(a), board.indexOf(b), board.indexOf(c)];
  const els = indices.map(i => boardEl.children[i]);

  const now = Date.now();
  setTimes.push(now - lastSetTime);
  lastSetTime = now;

  showToast('Computer found a Set!', 2200);
  computerScore++;
  updateScoreDisplay();

  flyCardsToScore(els, scoreComputerCardEl, () => {
    replaceOrRemoveCards(indices);

    ensureSetOnBoard(() => {
      busy = false;
      updateStatus();
      if (!checkGameOver() && !paused) scheduleComputerMove();
    });
  });
}

// ── Game Over ────────────────────────────────────────────────
/**
 * Check if the game is over. Returns true if so (and triggers end-game UI).
 * @returns {boolean}
 */
function checkGameOver() {
  if (deck.length === 0 && !hasSet(board)) {
    clearComputerTimer();
    showGameOver();
    return true;
  }
  return false;
}

function showGameOver() {
  stopTimer();
  modalScores.innerHTML = '';

  if (gameMode === 'vs-computer') {
    const resultText = score > computerScore ? 'You win!'
                     : score < computerScore ? 'Computer wins!'
                     : "It's a tie!";

    const resultRow = document.createElement('div');
    resultRow.className = 'final-score-row';
    resultRow.innerHTML = `<span class="winner-label">Result</span><span>${resultText}</span>`;
    modalScores.appendChild(resultRow);

    const p1Row = document.createElement('div');
    p1Row.className = 'final-score-row';
    p1Row.innerHTML = `<span class="winner-label">Player 1</span><span>${score} ${pluralize(score, 'Set')}</span>`;
    modalScores.appendChild(p1Row);

    const cpuRow = document.createElement('div');
    cpuRow.className = 'final-score-row';
    cpuRow.innerHTML = `<span class="winner-label">Computer</span><span>${computerScore} ${pluralize(computerScore, 'Set')}</span>`;
    modalScores.appendChild(cpuRow);

    const timeRow = document.createElement('div');
    timeRow.className = 'final-score-row';
    timeRow.innerHTML = `<span class="winner-label">Time</span><span>${finalTimeStr}</span>`;
    modalScores.appendChild(timeRow);
  } else {
    const scoreRow = document.createElement('div');
    scoreRow.className = 'final-score-row';
    scoreRow.innerHTML = `<span class="winner-label">Player 1</span><span>${score} ${pluralize(score, 'Set')}</span>`;
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
  }

  modalOverlay.classList.remove('hidden');
}

// ── UI Updates ────────────────────────────────────────────────
function updateScoreDisplay() {
  scoreP1El.textContent = score;
  if (gameMode === 'vs-computer') {
    scoreComputerEl.textContent = computerScore;
  }
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

function startTimerInterval() {
  timerInterval = setInterval(() => {
    timerDisplayEl.textContent = formatTime(Date.now() - timerStart);
  }, 1000);
}

function startTimer() {
  clearInterval(timerInterval);
  timerStart = Date.now();
  lastSetTime = timerStart;
  setTimes = [];
  timerDisplayEl.textContent = '0:00';
  startTimerInterval();
}

function stopTimer() {
  finalTimeStr = formatTime(Date.now() - timerStart);
  timerDisplayEl.textContent = finalTimeStr;
  clearInterval(timerInterval);
  timerInterval = null;
}

// ── Pause / Resume ────────────────────────────────────────────
function pauseGame() {
  if (paused || !timerInterval) return; // already paused or no game in progress
  paused = true;

  // Freeze the timer
  pausedElapsed = Date.now() - timerStart;
  clearInterval(timerInterval);
  timerInterval = null;

  // Capture remaining computer time, then cancel the timer
  if (gameMode === 'vs-computer' && computerTimerDeadline > 0) {
    computerPauseRemaining = Math.max(0, computerTimerDeadline - Date.now());
    clearComputerTimer();
  }

  pauseOverlay.classList.remove('hidden');
}

function resumeGame() {
  if (!paused) return;
  paused = false;

  // Resume the timer from where it left off
  timerStart = Date.now() - pausedElapsed;
  startTimerInterval();

  // Reschedule the computer with its remaining time
  if (gameMode === 'vs-computer' && computerPauseRemaining > 0) {
    computerTimerDeadline = Date.now() + computerPauseRemaining;
    computerTimerHandle = setTimeout(computerTakesSet, computerPauseRemaining);
    computerPauseRemaining = 0;
  }

  pauseOverlay.classList.add('hidden');
}

// ── All Sets Overlay ──────────────────────────────────────────
function showSetsOverlay() {
  if (paused) return;
  const sets = findAllSets(board);
  setsOverlayList.innerHTML = '';

  if (sets.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'no-sets-msg';
    msg.textContent = 'No Sets on the current board.';
    setsOverlayList.appendChild(msg);
  } else {
    renderSetList(sets, setsOverlayList);
  }

  setsOverlay.classList.remove('hidden');
}

function closeSetsOverlay() {
  setsOverlay.classList.add('hidden');
}

// ── Event Wiring ─────────────────────────────────────────────
btnNewGame.addEventListener('click', showModeModal);
btnPlayAgain.addEventListener('click', showModeModal);
btnHint.addEventListener('click', showHint);
btnShowSets.addEventListener('click', showSetsOverlay);
btnCloseSets.addEventListener('click', closeSetsOverlay);

btnSolo.addEventListener('click', () => {
  gameMode = 'solo';
  startGame();
});

btnVsComputer.addEventListener('click', showDifficultyModal);

btnBackToMode.addEventListener('click', showModeModal);

document.querySelectorAll('.difficulty-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    gameMode   = 'vs-computer';
    difficulty = btn.dataset.difficulty;
    startGame();
  });
});

btnPause.addEventListener('click', pauseGame);
btnResume.addEventListener('click', resumeGame);

setsOverlay.addEventListener('pointerdown', e => {
  if (e.target === setsOverlay) closeSetsOverlay();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && paused) { resumeGame(); return; }
  if (e.key === 'Escape' && !setsOverlay.classList.contains('hidden')) closeSetsOverlay();
});

// ── Start ────────────────────────────────────────────────────
showModeModal();
