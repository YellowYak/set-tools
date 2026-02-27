/**
 * multi-play.js — Multiplayer game board for the Set card game.
 *
 * All game state lives in Firebase Realtime Database. This module:
 *   - Listens to /games/{gameId} for real-time state updates
 *   - Renders the board and score panel on each update
 *   - Submits Set claims via runTransaction (first claim wins atomically)
 *   - Detects game-over and saves results to Firestore for signed-in players
 */

import {
  ref, onValue, runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-database.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import { auth, rtdb }    from './firebase-init.js';
import { createDeck }    from './deck.js';
import { isSet, hasSet, findAllSets } from './set-logic.js';
import { createCardEl }  from './card-render.js';
import { saveMultiplayerGame } from './db.js';
import { getPlayerId } from './guest-identity.js';

// ─── Canonical deck (deterministic — createDeck() always returns the same 81 cards) ──
const CANONICAL_DECK = createDeck();

// ─── State ────────────────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const gameId = params.get('game');

// Seed identity from cached auth (may be null; onAuthStateChanged will update)
let currentUser = auth.currentUser;
let playerId    = getPlayerId(currentUser);

let gameState    = null;   // latest /games/{gameId} snapshot value
let selected     = [];     // board positions selected locally (never written to RTDB)
let busy         = false;  // true while a runTransaction is in-flight
let gameSaved    = false;  // guard against saving the same game twice

let nextPenaltySecs    = 2;    // penalty duration for next invalid submission; escalates each mistake
let penaltyTimerHandle = null; // setInterval handle for the penalty countdown display

let prevBoardSet = new Set();   // canonical indices rendered in the previous frame
let prevScores   = null;        // null = not yet initialized; populated on first state update
let timerInterval = null;

// ─── DOM references ───────────────────────────────────────────────────────────
const scorePanelEl     = document.getElementById('mp-score-panel');
const statusEl         = document.getElementById('mp-status');
const boardEl          = document.getElementById('board');
const modalOverlay     = document.getElementById('modal-overlay');
const modalResult      = document.getElementById('modal-result');
const modalScores      = document.getElementById('modal-scores');
const saveNudgeEl      = document.getElementById('modal-save-nudge');
const penaltyOverlayEl   = document.getElementById('penalty-overlay');
const penaltyBarEl       = document.getElementById('penalty-bar');
const penaltyCountdownEl = document.getElementById('penalty-countdown');

// ─── Auth ─────────────────────────────────────────────────────────────────────

onAuthStateChanged(auth, user => {
  currentUser = user;
  playerId    = getPlayerId(user);
});

// ─── Entry point ──────────────────────────────────────────────────────────────

if (!gameId) {
  window.location.href = 'lobby.html';
} else {
  onValue(ref(rtdb, `games/${gameId}`), snap => {
    if (!snap.exists()) {
      showToast('Game not found.');
      return;
    }
    handleStateUpdate(snap.val());
  });
}

// ─── Core state handler ───────────────────────────────────────────────────────

function handleStateUpdate(newState) {
  gameState = newState;

  checkScoreChanges(newState.players ?? {});
  renderScorePanel(newState.players ?? {});
  renderBoard(newState.board ?? []);
  updateStatusBar();

  if (newState.status === 'playing') {
    startTimer(newState.startedAt);
    // Any client can trigger the extra-deal if there's no set on board
    ensureSetOnBoard();
  }

  if (newState.status === 'finished') {
    stopTimer();
    showGameOver(newState);
  }
}

// ─── Score change detection ───────────────────────────────────────────────────

function checkScoreChanges(players) {
  if (prevScores === null) {
    // First update — record baseline scores, don't fire toasts
    prevScores = {};
    for (const [pid, p] of Object.entries(players)) {
      prevScores[pid] = p.score || 0;
    }
    return;
  }

  for (const [pid, p] of Object.entries(players)) {
    const newScore = p.score || 0;
    const oldScore = prevScores[pid] ?? 0;

    if (newScore > oldScore) {
      // Any player scoring resets the local penalty counter
      nextPenaltySecs = 2;

      // Show toast only for opponents — own set is already toasted in attemptClaimSet
      if (pid !== playerId) {
        showToast(`${p.name} found a Set!`, 2800);
      }
    }

    // Always update prevScores for all players, including self
    prevScores[pid] = newScore;
  }
}

// ─── Score panel ─────────────────────────────────────────────────────────────

function renderScorePanel(players) {
  const entries = Object.entries(players).sort((a, b) => (b[1].score || 0) - (a[1].score || 0));

  scorePanelEl.style.gridTemplateColumns = `repeat(${entries.length}, auto)`;
  scorePanelEl.innerHTML = '';

  for (const [pid, p] of entries) {
    const card = document.createElement('div');
    card.className = 'score-card' + (pid === playerId ? ' score-card--you' : '');
    card.innerHTML = `
      <div class="player-name">${escHtml(p.name)}${pid === playerId ? ' <span style="font-size:0.65em;opacity:0.7">(you)</span>' : ''}</div>
      <div class="player-score">${p.score || 0}</div>
      <div class="score-label">Sets found</div>
    `;
    scorePanelEl.appendChild(card);
  }
}

// ─── Board rendering ──────────────────────────────────────────────────────────

function renderBoard(boardIndices) {
  // Clear local selection on every state update — the board may have changed
  selected = [];
  boardEl.innerHTML = '';

  let newCardStagger = 0;

  boardIndices.forEach((canonicalIdx, position) => {
    const card = CANONICAL_DECK[canonicalIdx];
    const el   = createCardEl(card);

    el.style.setProperty('--card-rotate', `${(Math.random() * 6 - 3).toFixed(1)}deg`);

    // Animate only cards that weren't on the board in the previous render
    if (!prevBoardSet.has(canonicalIdx)) {
      dealInCard(el, newCardStagger);
      newCardStagger += 60;
    }

    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      onCardSelect(position);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onCardSelect(position);
      }
    });

    boardEl.appendChild(el);
  });

  prevBoardSet = new Set(boardIndices);
}

function dealInCard(el, delayMs) {
  el.classList.add('dealing');
  el.style.animationDelay = `${delayMs}ms`;
  el.addEventListener('animationend', () => {
    el.classList.remove('dealing');
    el.style.animationDelay = '';
  }, { once: true });
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function updateStatusBar() {
  if (!gameState) return;
  const state       = gameState;
  const board       = state.board ?? [];
  const deckPointer = state.deckPointer ?? 81;
  const remaining   = 81 - deckPointer;

  if (state.status === 'playing') {
    const elapsed    = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
    const mins       = Math.floor(elapsed / 60);
    const secs       = elapsed % 60;
    const timerPart  = `${mins}:${secs.toString().padStart(2, '0')}`;
    const boardCards = board.map(i => CANONICAL_DECK[i]);
    const setCount   = findAllSets(boardCards).length;
    const deckPart   = remaining > 0
      ? `${remaining} card${remaining !== 1 ? 's' : ''} in deck`
      : 'Deck empty';
    statusEl.textContent = `${timerPart} · ${deckPart} · ${setCount} set${setCount !== 1 ? 's' : ''} on board`;
  } else if (state.status === 'finished') {
    statusEl.textContent = 'Game over';
  }
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function startTimer(startedAt) {
  if (timerInterval || !startedAt) return;
  timerInterval = setInterval(updateStatusBar, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  // Cancel any active penalty so the countdown doesn't run after the game ends
  clearInterval(penaltyTimerHandle);
  penaltyTimerHandle = null;
  penaltyOverlayEl.classList.add('hidden');
  penaltyBarEl.classList.add('hidden');
}

// ─── Card selection (local only — never written to RTDB) ─────────────────────

function onCardSelect(position) {
  if (busy || !gameState || gameState.status !== 'playing') return;

  const idx = selected.indexOf(position);
  if (idx !== -1) {
    // Deselect
    selected.splice(idx, 1);
    updateSelectionUI();
    return;
  }
  if (selected.length >= 3) return;

  selected.push(position);
  updateSelectionUI();

  if (selected.length === 3) {
    const toSubmit = selected.slice();
    selected = [];
    updateSelectionUI();
    attemptClaimSet(toSubmit);
  }
}

function updateSelectionUI() {
  Array.from(boardEl.children).forEach((el, i) => {
    el.classList.toggle('selected', selected.includes(i));
  });
}

// ─── Set claim (atomic via RTDB transaction) ──────────────────────────────────

async function attemptClaimSet(positions) {
  busy = true;

  // Quick local pre-check so we can flash the error immediately without a
  // round-trip. The transaction still validates server-side for correctness.
  const board = gameState?.board ?? [];
  const cards = positions.map(pos => CANONICAL_DECK[board[pos]]);
  if (positions.some(pos => pos >= board.length) || !isSet(cards[0], cards[1], cards[2])) {
    applyPenalty(positions);
    return; // busy stays true — clearPenalty() resets it after the countdown
  }

  try {
    const result = await runTransaction(ref(rtdb, `games/${gameId}`), currentData => {
      if (!currentData || currentData.status !== 'playing') return; // abort

      const rtdbBoard = currentData.board ?? [];

      // Guard: claimed positions must still be valid (board may have changed)
      for (const pos of positions) {
        if (pos < 0 || pos >= rtdbBoard.length) return; // abort
      }

      // Validate the three cards form a Set
      const [a, b, c] = positions.map(pos => CANONICAL_DECK[rtdbBoard[pos]]);
      if (!isSet(a, b, c)) return; // abort

      // Guard: claiming player must still be in the game
      if (!currentData.players?.[playerId]) return; // abort

      // Award point
      currentData.players[playerId].score = (currentData.players[playerId].score || 0) + 1;

      // Remove claimed cards high-to-low so earlier splice indices stay valid
      const sorted   = [...positions].sort((a, b) => b - a);
      const newBoard = Array.from(rtdbBoard);
      let ptr        = currentData.deckPointer ?? 81;

      for (const pos of sorted) {
        if (ptr < 81 && newBoard.length <= 12) {
          // Replace in-place while board is at base size
          newBoard[pos] = currentData.shuffledIndices[ptr++];
        } else {
          // Board has extra cards (>12) — just remove
          newBoard.splice(pos, 1);
        }
      }

      // If no set remains and deck has cards, deal 3 more
      if (!hasSet(newBoard.map(i => CANONICAL_DECK[i])) && ptr < 81) {
        const toAdd = Math.min(3, 81 - ptr);
        for (let i = 0; i < toAdd; i++) {
          newBoard.push(currentData.shuffledIndices[ptr++]);
        }
      }

      currentData.board       = newBoard;
      currentData.deckPointer = ptr;

      // Detect game over: deck exhausted and no sets left
      if (ptr >= 81 && !hasSet(newBoard.map(i => CANONICAL_DECK[i]))) {
        let maxScore = -1;
        let winnerId = null;
        for (const [pid, p] of Object.entries(currentData.players)) {
          const score = p.score || 0;
          if (score > maxScore) {
            maxScore = score;
            winnerId = pid;
          } else if (score === maxScore) {
            winnerId = null; // tie
          }
        }
        currentData.status    = 'finished';
        currentData.finishedAt = Date.now();
        currentData.winnerId   = winnerId;
      }

      return currentData;
    });

    if (result.committed) {
      showToast('Set!');
    } else {
      // Transaction aborted — either not a set or board changed under us
      showToast('Too slow — try another!');
    }
  } catch (err) {
    showToast('Connection error — please try again.');
    console.error('attemptClaimSet:', err);
  } finally {
    busy = false;
  }
}

// ─── Auto-deal when no set is on the board ────────────────────────────────────

async function ensureSetOnBoard() {
  if (!gameState || gameState.status !== 'playing') return;

  const board = gameState.board ?? [];
  if (hasSet(board.map(i => CANONICAL_DECK[i]))) return; // already fine
  if ((gameState.deckPointer ?? 81) >= 81) return;        // no cards left to deal

  // Any client can submit this transaction; only the first commit wins
  try {
    await runTransaction(ref(rtdb, `games/${gameId}`), currentData => {
      if (!currentData || currentData.status !== 'playing') return;

      const rtdbBoard = currentData.board ?? [];
      if (hasSet(rtdbBoard.map(i => CANONICAL_DECK[i]))) return; // another client already dealt
      if (currentData.deckPointer >= 81) return;

      const newBoard = Array.from(rtdbBoard);
      let ptr        = currentData.deckPointer;
      const toAdd    = Math.min(3, 81 - ptr);
      for (let i = 0; i < toAdd; i++) {
        newBoard.push(currentData.shuffledIndices[ptr++]);
      }

      currentData.board       = newBoard;
      currentData.deckPointer = ptr;
      return currentData;
    });
  } catch (err) {
    console.error('ensureSetOnBoard:', err);
  }
}

// ─── Penalty (invalid set submission) ────────────────────────────────────────

function applyPenalty(positions) {
  const penaltySeconds = nextPenaltySecs;
  nextPenaltySecs++;

  // 1. Flash the cards red (fix: use flash-error, not error)
  const cardEls = Array.from(boardEl.children);
  positions.forEach(pos => cardEls[pos]?.classList.add('flash-error'));
  setTimeout(() => {
    positions.forEach(pos => cardEls[pos]?.classList.remove('flash-error'));
  }, 650);

  // 2. Toast message
  showToast(`Not a set: ${penaltySeconds}-second penalty.`, 2800);

  // 3. Dim board (also blocks pointer events via CSS .board--penalized)
  boardEl.classList.add('board--penalized');

  // 4. Show overlay tint and initialize the countdown banner
  penaltyOverlayEl.classList.remove('hidden');
  penaltyCountdownEl.textContent = penaltySeconds.toFixed(1);
  penaltyBarEl.classList.remove('hidden');

  // 5. Tick the countdown every 100ms (tenths of a second)
  let remaining = penaltySeconds * 10; // track in tenths
  clearInterval(penaltyTimerHandle);
  penaltyTimerHandle = setInterval(() => {
    remaining--;
    penaltyCountdownEl.textContent = (remaining / 10).toFixed(1);
    if (remaining <= 0) {
      clearPenalty();
    }
  }, 100);

  // 6. Belt-and-suspenders: hard cutoff in case interval drifts
  setTimeout(clearPenalty, penaltySeconds * 1000 + 50);
}

function clearPenalty() {
  if (!penaltyTimerHandle && penaltyBarEl.classList.contains('hidden')) return; // already cleared

  clearInterval(penaltyTimerHandle);
  penaltyTimerHandle = null;

  boardEl.classList.remove('board--penalized');
  penaltyOverlayEl.classList.add('hidden');
  penaltyBarEl.classList.add('hidden');
  busy = false; // re-enable card selection
}

// ─── Game over ───────────────────────────────────────────────────────────────

async function showGameOver(state) {
  clearPenalty(); // ensure busy=false and penalty UI dismissed even if game ends mid-penalty
  if (modalOverlay.classList.contains('hidden') === false) return; // already shown

  const players  = state.players ?? {};
  const winnerId = state.winnerId;

  // Result headline
  if (winnerId === playerId) {
    modalResult.textContent = 'You win!';
  } else if (winnerId) {
    modalResult.textContent = `${escHtml(players[winnerId]?.name ?? 'Someone')} wins!`;
  } else {
    modalResult.textContent = "It's a tie!";
  }

  // Final scores, sorted descending
  modalScores.innerHTML = Object.entries(players)
    .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
    .map(([pid, p]) => `
      <div class="final-score-row">
        <span>${escHtml(p.name)}${pid === playerId ? ' <em style="opacity:0.6;font-size:0.85em">(you)</em>' : ''}</span>
        <span>${p.score || 0} Set${p.score !== 1 ? 's' : ''}</span>
      </div>
    `)
    .join('');

  modalOverlay.classList.remove('hidden');

  // Save to Firestore for signed-in players (once per client)
  if (currentUser && !gameSaved) {
    gameSaved = true;
    try {
      await saveMultiplayerGame(state, playerId, currentUser.uid);
      saveNudgeEl.textContent = '✓ Results saved to your history.';
    } catch (err) {
      console.error('saveMultiplayerGame:', err);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function showToast(message, duration = 2800) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hiding');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
