/**
 * play.js — Game loop for play.html
 *
 * State:
 *   deck             — remaining undealt cards
 *   board            — cards currently visible (parallel array to DOM children of #board)
 *   selected         — indices (into board) of currently selected cards (max 3)
 *   score            — player 1's sets found
 *   busy             — true while an animation is running (blocks new selections)
 *   gameMode         — MODE_SOLO | MODE_VS_COMPUTER
 *   difficulty       — 'easy' | 'medium' | 'hard' | 'genius'
 *   computerScore    — sets found by the computer
 *   computerTimerHandle — setTimeout handle for the computer's next move
 */

import { createDeck, shuffle, pluralize } from './deck.js';
import { isSet, findAllSets, hasSet } from './set-logic.js';
import { createCardEl, renderSetList } from './card-render.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import { auth } from './firebase-init.js';
import { saveGame } from './db.js';

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

// ── Game Mode Constants ─────────────────────────────────────
const MODE_SOLO        = 'solo';
const MODE_VS_COMPUTER = 'vs-computer';

// ── Game State ──────────────────────────────────────────────
let deck     = [];
let board    = [];   // card objects on the board
let selected = [];   // indices into board[]
let score    = 0;
let busy     = false;

// Mode & computer state
let gameMode          = MODE_SOLO;  // MODE_SOLO | MODE_VS_COMPUTER
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
let playerSetTimes = [];  // ms elapsed for each Set found by the player

// Stats counters (saved to Firestore on game over)
let hintsUsed       = 0;  // number of hint card reveals used
let mistakeCount    = 0;  // number of invalid Set submissions
let extraCardsDealt = 0;  // number of times 3 extra cards were dealt (no set on board)

// Auth state (kept in sync via onAuthStateChanged subscription below)
let currentUser      = null;
let pendingGameRecord = null; // held when game ends as guest; saved on sign-in

// ── Redirect-auth pending-game persistence ───────────────────────────────────
// signInWithRedirect navigates the page away and back, wiping in-memory state.
// sessionStorage survives that navigation within the same tab.
const PENDING_GAME_KEY = 'set_pendingGameRecord';

function savePendingGameToSession(record) {
  try { sessionStorage.setItem(PENDING_GAME_KEY, JSON.stringify(record)); }
  catch { /* sessionStorage may be blocked in some private-browsing contexts */ }
}

function clearPendingGameFromSession() {
  try { sessionStorage.removeItem(PENDING_GAME_KEY); } catch { /* ignore */ }
}

function loadPendingGameFromSession() {
  try {
    const raw = sessionStorage.getItem(PENDING_GAME_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

onAuthStateChanged(auth, user => {
  currentUser = user;
  // If the user signs in while a completed game is waiting to be saved, do it now.
  if (user && pendingGameRecord) {
    const record    = pendingGameRecord;
    pendingGameRecord = null;
    clearPendingGameFromSession();
    const nudgeEl   = document.getElementById('modal-save-nudge');
    if (nudgeEl) nudgeEl.innerHTML = '';
    saveGame({ ...record, uid: user.uid })
      .then(() => {
        if (nudgeEl) {
          nudgeEl.innerHTML = '<div class="save-nudge save-nudge--saved">✓ Results saved</div>';
        }
      })
      .catch(() => { /* fail silently */ });
  }
});

// Pause state
let paused                = false;
let pausedElapsed         = 0; // ms elapsed when paused
let computerTimerDeadline = 0; // Date.now() + delay when computer timer was scheduled
let computerPauseRemaining = 0; // ms left on computer timer when paused

// ── Animation Timing Constants (ms) ─────────────────────────
const DEAL_STAGGER_MS        = 80;   // delay between successive cards dealing in
const REPLACE_STAGGER_MS     = 70;   // delay between successive cards replacing
const ERROR_FLASH_MS         = 650;  // error flash animation duration
const COMPUTER_RETRY_MS      = 300;  // retry delay when busy blocks a computer move
const EXTRA_DEAL_PAUSE_MS    = 3000; // pause before dealing extra cards (no set on board)
const FLY_DURATION_MS        = 350;  // CSS transition duration per card clone
const FLY_STAGGER_MS         = 70;   // ms between launching successive clones
const FLY_CALLBACK_BUFFER_MS = 40;   // ms after last clone lands before onComplete fires
const CLONE_CLEANUP_MS       = 20;   // ms after each clone's flight before it's removed
const PULSE_LEAD_MS          = 60;   // ms before last clone lands that score pulse fires

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

  // Show or hide controls based on mode
  btnHint.classList.toggle('hidden', gameMode !== MODE_SOLO);
  btnShowSets.classList.toggle('hidden', gameMode !== MODE_SOLO);
  scoreComputerCardEl.classList.toggle('hidden', gameMode !== MODE_VS_COMPUTER);
  document.getElementById('computer-difficulty').textContent =
    gameMode === MODE_VS_COMPUTER ? difficulty : '';

  paused = false;
  pausedElapsed = 0;
  computerTimerDeadline = 0;
  computerPauseRemaining = 0;
  hintsUsed = 0;
  mistakeCount = 0;
  extraCardsDealt = 0;
  pendingGameRecord = null;
  clearPendingGameFromSession();

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

  if (gameMode === MODE_VS_COMPUTER) {
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
    dealInCard(el, startDelayMs + i * DEAL_STAGGER_MS);
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
    for (const { idx, i } of sorted) replaceCard(idx, i * REPLACE_STAGGER_MS);
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
    extraCardsDealt++;
    dealCards(3, 0);
    ensureSetOnBoard(onDone, true);
  }, EXTRA_DEAL_PAUSE_MS);
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
  const cards = selected.map(i => board[i]);
  const els   = selected.map(i => boardEl.children[i]);

  if (isSet(...cards)) {
    handleSuccess(els, selected);
  } else {
    handleError(els);
  }
}

// ── Success ─────────────────────────────────────────────────
function handleSuccess(els, indices) {
  const now = Date.now();
  playerSetTimes.push(now - lastSetTime);
  lastSetTime = now;
  busy = true;
  resetHint();

  if (gameMode === MODE_VS_COMPUTER) {
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
    updateStatus();

    ensureSetOnBoard(() => {
      busy = false;
      updateStatus();
      if (!checkGameOver() && gameMode === MODE_VS_COMPUTER && !paused) {
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

  // Stagger: last clone lands at t = FLY_STAGGER_MS * 2 + FLY_DURATION_MS
  const TOTAL_MS = FLY_STAGGER_MS * (els.length - 1) + FLY_DURATION_MS + FLY_CALLBACK_BUFFER_MS;

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
      transition: transform ${FLY_DURATION_MS}ms ease-in ${i * FLY_STAGGER_MS}ms,
                  opacity   ${FLY_DURATION_MS}ms ease-in ${i * FLY_STAGGER_MS}ms;
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
    const cloneRemoveAt = FLY_STAGGER_MS * i + FLY_DURATION_MS + CLONE_CLEANUP_MS;
    setTimeout(() => clone.remove(), cloneRemoveAt);
  });

  // Pulse the target score card as the last clone arrives
  const pulseAt = FLY_STAGGER_MS * (els.length - 1) + FLY_DURATION_MS - PULSE_LEAD_MS;
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
  mistakeCount++;
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
  }, ERROR_FLASH_MS);
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
    hintsUsed++;

    const remaining = 3 - hintStep;
    const toastMsg = remaining > 0
      ? `${remaining} ${pluralize(remaining, 'card')} still hidden — click Hint again`
      : 'All three cards of the Set are highlighted.';
    showToast(toastMsg);
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
    computerTimerHandle = setTimeout(computerTakesSet, COMPUTER_RETRY_MS);
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

  lastSetTime = Date.now();

  showToast('Computer found a Set!', 2200);
  computerScore++;
  updateScoreDisplay();

  flyCardsToScore(els, scoreComputerCardEl, () => {
    replaceOrRemoveCards(indices);
    updateStatus();

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

/** Append a labeled score row to a container element. */
function appendScoreRow(container, label, value) {
  const row = document.createElement('div');
  row.className = 'final-score-row';
  row.innerHTML = `<span class="winner-label">${label}</span><span>${value}</span>`;
  container.appendChild(row);
}

/**
 * Append the set-times breakdown section (label, scrollable per-set list,
 * avg and fastest summary rows) to a container. No-ops if times is empty.
 * @param {HTMLElement} container
 * @param {number[]}    times   ms elapsed for each player Set
 * @param {string}      label   Section heading text
 */
function appendSetTimesSection(container, times, label = 'Set Times') {
  if (times.length === 0) return;
  const avgMs     = times.reduce((a, b) => a + b, 0) / times.length;
  const fastestMs = Math.min(...times);

  const labelEl = document.createElement('p');
  labelEl.className = 'set-times-label';
  labelEl.textContent = label;
  container.appendChild(labelEl);

  const list = document.createElement('div');
  list.className = 'set-times-breakdown';
  times.forEach((ms, i) => {
    const row = document.createElement('div');
    row.className = 'set-time-row';
    row.innerHTML = `<span>Set ${i + 1}</span><span>${formatTime(ms)}</span>`;
    list.appendChild(row);
  });
  container.appendChild(list);

  appendScoreRow(container, 'Avg / Set', formatTime(avgMs));
  appendScoreRow(container, 'Fastest',   formatTime(fastestMs));
}

/**
 * Build the Firestore game record from current game state.
 * Pure data construction — no side effects.
 * @returns {Object}
 */
function buildGameRecord() {
  const durationMs = Date.now() - timerStart;
  return {
    uid:            currentUser?.uid ?? null,
    gameMode,
    difficulty:     gameMode === MODE_VS_COMPUTER ? difficulty : null,
    durationMs,
    playerSets:     score,
    computerSets:   gameMode === MODE_VS_COMPUTER ? computerScore : null,
    outcome:        gameMode === MODE_VS_COMPUTER
                      ? (score > computerScore ? 'win' : score < computerScore ? 'loss' : 'tie')
                      : null,
    hintsUsed,
    mistakeCount,
    extraCardsDealt,
    setTimesMs:     [...playerSetTimes],
    avgSetTimeMs:   playerSetTimes.length
                      ? Math.round(playerSetTimes.reduce((a, b) => a + b, 0) / playerSetTimes.length)
                      : null,
    fastestSetMs:   playerSetTimes.length ? Math.min(...playerSetTimes) : null,
    slowestSetMs:   playerSetTimes.length ? Math.max(...playerSetTimes) : null,
  };
}

function showGameOver() {
  stopTimer();

  // ── Persist game record to Firestore ────────────────────────────────────
  const gameRecord = buildGameRecord();

  const nudgeEl = document.getElementById('modal-save-nudge');
  nudgeEl.innerHTML = '';

  if (currentUser) {
    pendingGameRecord = null;
    saveGame(gameRecord)
      .then(() => {
        nudgeEl.innerHTML = '<div class="save-nudge save-nudge--saved">✓ Results saved</div>';
      })
      .catch(() => { /* fail silently */ });
  } else {
    pendingGameRecord = gameRecord; // saved by onAuthStateChanged if user signs in
    savePendingGameToSession(gameRecord);
    nudgeEl.innerHTML = `
      <div class="save-nudge">
        Sign in to save your results
        <button class="save-nudge-btn" id="btn-save-sign-in">Sign In</button>
      </div>`;
    document.getElementById('btn-save-sign-in')
      .addEventListener('pointerdown', e => {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('open-auth-modal'));
      });
  }

  modalScores.innerHTML = '';

  if (gameMode === MODE_VS_COMPUTER) {
    const resultText = score > computerScore ? 'You win!'
                     : score < computerScore ? 'Computer wins!'
                     : "It's a tie!";

    appendScoreRow(modalScores, 'Result',   resultText);
    appendScoreRow(modalScores, 'Player 1', `${score} ${pluralize(score, 'Set')}`);
    appendScoreRow(modalScores, 'Computer', `${computerScore} ${pluralize(computerScore, 'Set')}`);
    appendScoreRow(modalScores, 'Time',     finalTimeStr);
    appendScoreRow(modalScores, 'Mistakes', mistakeCount.toString());

    appendSetTimesSection(modalScores, playerSetTimes, 'Your Set Times');
  } else {
    appendScoreRow(modalScores, 'Player 1', `${score} ${pluralize(score, 'Set')}`);
    appendScoreRow(modalScores, 'Time',     finalTimeStr);
    appendScoreRow(modalScores, 'Hints',    hintsUsed.toString());
    appendScoreRow(modalScores, 'Mistakes', mistakeCount.toString());

    appendSetTimesSection(modalScores, playerSetTimes);
  }

  modalOverlay.classList.remove('hidden');
}

// ── UI Updates ────────────────────────────────────────────────
function updateScoreDisplay() {
  scoreP1El.textContent = score;
  if (gameMode === MODE_VS_COMPUTER) {
    scoreComputerEl.textContent = computerScore;
  }
}

function updateStatus() {
  const remaining = deck.length;
  const setCount  = findAllSets(board).length;
  statusEl.textContent = `${remaining} ${pluralize(remaining, 'card')} left · ${setCount} ${pluralize(setCount, 'set')} present`;
}

// ── Timer ─────────────────────────────────────────────────────
function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
  playerSetTimes = [];
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
  if (gameMode === MODE_VS_COMPUTER && computerTimerDeadline > 0) {
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
  if (gameMode === MODE_VS_COMPUTER && computerPauseRemaining > 0) {
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
  gameMode = MODE_SOLO;
  startGame();
});

btnVsComputer.addEventListener('click', showDifficultyModal);

btnBackToMode.addEventListener('click', showModeModal);

document.querySelectorAll('.difficulty-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    gameMode   = MODE_VS_COMPUTER;
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

// Restore pending game record if the user was redirected to Google from this
// page. The in-memory pendingGameRecord is null after a page reload, but
// sessionStorage survives the redirect. onAuthStateChanged (above) will save
// it to Firestore once Firebase resolves the returning user's session.
const restoredGame = loadPendingGameFromSession();
if (restoredGame) pendingGameRecord = restoredGame;

showModeModal();
