/**
 * lobby.js — Multiplayer lobby for the Set card game.
 *
 * Handles game creation, the public game list, shareable invite links,
 * the pre-game waiting room, and player presence via onDisconnect hooks.
 */

import {
  ref, push, set, get, update, onValue, remove, onDisconnect, runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-database.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import { auth, rtdb }         from './firebase-init.js';
import { createDeck, shuffle } from './deck.js';
import { hasSet }              from './set-logic.js';
import {
  getPlayerId, getDisplayName, getGuestName, setGuestName,
} from './guest-identity.js';
import { showToast, escHtml } from './utils.js';

// ─── Canonical deck (deterministic, never mutated) ────────────────────────────
const CANONICAL_DECK = createDeck();

// ─── Module state ─────────────────────────────────────────────────────────────
let currentUser   = null;
let playerId      = null;
let playerName    = null;
let currentGameId = null;
let unsubGame     = null;   // detach fn for the /games/{id} onValue listener
let initialized   = false;  // guard against double-init from auth state changes

// ─── DOM references ───────────────────────────────────────────────────────────
const nameModal       = document.getElementById('name-modal');
const nameInput       = document.getElementById('name-input');
const nameError       = document.getElementById('name-error');
const nameForm        = document.getElementById('name-form');

const lobbyEntry      = document.getElementById('lobby-entry');
const playerCountForm = document.getElementById('player-count-form');
const createBtn       = document.getElementById('btn-create-game');
const joinCodeInput   = document.getElementById('join-code-input');
const joinCodeBtn     = document.getElementById('btn-join-code');
const gameItemsEl     = document.getElementById('lobby-game-items');
const noGamesEl       = document.getElementById('lobby-no-games');
const refreshBtn      = document.getElementById('btn-refresh');
const createError     = document.getElementById('create-error');

const waitingSection     = document.getElementById('lobby-waiting');
const waitingTitle       = document.getElementById('waiting-title');
const linkDisplay        = document.getElementById('lobby-link-display');
const copyLinkBtn        = document.getElementById('btn-copy-link');
const playerListEl       = document.getElementById('lobby-player-list');
const startBtn           = document.getElementById('btn-start-game');
const leaveBtn           = document.getElementById('btn-leave-game');
const waitingMsg         = document.getElementById('lobby-waiting-msg');
const startError         = document.getElementById('lobby-start-error');
const gamePrivateToggle  = document.getElementById('game-private-toggle');
const lobbyPrivateNotice = document.getElementById('lobby-private-notice');

// ─── Auth init ────────────────────────────────────────────────────────────────

onAuthStateChanged(auth, user => {
  currentUser = user;
  playerId    = getPlayerId(user);
  playerName  = getDisplayName(user);

  if (initialized) return;
  initialized = true;

  if (!user && !getGuestName()) {
    showNameModal();
  } else {
    continueInit();
  }
});

// ─── Name modal ───────────────────────────────────────────────────────────────

function showNameModal() {
  nameModal.classList.remove('hidden');
  nameInput.focus();
}

nameForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (name.length < 1) {
    nameError.textContent = 'Please enter a name.';
    nameError.classList.remove('hidden');
    return;
  }
  if (name.length > 24) {
    nameError.textContent = 'Name must be 24 characters or fewer.';
    nameError.classList.remove('hidden');
    return;
  }
  setGuestName(name);
  playerName = name;
  nameModal.classList.add('hidden');
  continueInit();
});

// ─── Post-identity init ───────────────────────────────────────────────────────

function continueInit() {
  bindEntryEvents();
  checkUrlJoin();
  loadPublicGames();
}

// ─── Entry panel event bindings ───────────────────────────────────────────────

function bindEntryEvents() {
  createBtn.addEventListener('click', () => {
    const checked = playerCountForm.querySelector('input[name="player-count"]:checked');
    const maxPlayers = checked ? parseInt(checked.value, 10) : 2;
    createGame(maxPlayers);
  });

  joinCodeBtn.addEventListener('click', handleJoinByCode);
  joinCodeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleJoinByCode();
  });

  refreshBtn.addEventListener('click', loadPublicGames);
  copyLinkBtn.addEventListener('click', copyShareLink);
  startBtn.addEventListener('click', () => startGame(currentGameId));
  leaveBtn.addEventListener('click', () => leaveGame(currentGameId));
}

function handleJoinByCode() {
  const raw = joinCodeInput.value.trim();
  if (!raw) return;
  // Accept either a bare game ID or a full invite URL
  let gameId = raw;
  try {
    const url = new URL(raw);
    gameId = url.searchParams.get('game') || raw;
  } catch {
    // raw is already a bare game ID — use as-is
  }
  joinGame(gameId);
}

// ─── URL-based auto-join ──────────────────────────────────────────────────────

function checkUrlJoin() {
  const params = new URLSearchParams(window.location.search);
  const gid = params.get('game');
  if (gid) joinGame(gid);
}

// ─── Public game list ─────────────────────────────────────────────────────────

async function loadPublicGames() {
  gameItemsEl.innerHTML = '<p class="lobby-loading-msg">Loading…</p>';
  noGamesEl.classList.add('hidden');

  try {
    const snap = await get(ref(rtdb, 'lobbies'));
    gameItemsEl.innerHTML = '';

    if (!snap.exists()) {
      noGamesEl.classList.remove('hidden');
      return;
    }

    const games = [];
    snap.forEach(child => {
      const g = child.val();
      if (g.status === 'waiting') games.push(g);
    });
    games.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (games.length === 0) {
      noGamesEl.classList.remove('hidden');
      return;
    }

    games.forEach(g => gameItemsEl.appendChild(buildGameItem(g)));
  } catch (err) {
    gameItemsEl.innerHTML = '<p class="lobby-loading-msg">Failed to load games.</p>';
    console.error('loadPublicGames:', err);
  }
}

function buildGameItem(g) {
  const div = document.createElement('div');
  div.className = 'lobby-game-item';
  div.innerHTML = `
    <div class="lobby-game-info">
      <div class="lobby-game-host">${escHtml(g.hostName)}'s game</div>
      <div class="lobby-game-count">${g.playerCount} / ${g.maxPlayers} players</div>
    </div>
    <button class="btn btn-secondary">Join</button>
  `;
  div.querySelector('.btn').addEventListener('click', () => joinGame(g.id));
  return div;
}

// ─── Create game ──────────────────────────────────────────────────────────────

async function createGame(maxPlayers) {
  createBtn.disabled = true;
  createError.classList.add('hidden');

  const isPrivate = gamePrivateToggle.checked;

  try {
    // Build a shuffled deck of indices and deal the first 12 cards,
    // extending by 3 at a time until at least one Set is on the board.
    const shuffledIndices = shuffle([...Array(81).keys()]);
    let deckPointer = 12;
    let board = shuffledIndices.slice(0, 12);
    while (!hasSet(board.map(i => CANONICAL_DECK[i])) && deckPointer < 81) {
      const toAdd = Math.min(3, 81 - deckPointer);
      board = [...board, ...shuffledIndices.slice(deckPointer, deckPointer + toAdd)];
      deckPointer += toAdd;
    }

    const gameRef  = push(ref(rtdb, 'games'));
    const gameId   = gameRef.key;
    const lobbyRef = ref(rtdb, `lobbies/${gameId}`);

    await set(gameRef, {
      status:          'waiting',
      isPrivate,
      maxPlayers,
      hostId:          playerId,
      shuffledIndices,
      deckPointer,
      board,
      players: {
        [playerId]: {
          name:      playerName,
          uid:       currentUser?.uid ?? null,
          score:     0,
          connected: true,
        },
      },
      startedAt:  null,
      finishedAt: null,
      winnerId:   null,
    });

    // Private games are not listed publicly — skip the lobby entry entirely.
    if (!isPrivate) {
      await set(lobbyRef, {
        id:          gameId,
        status:      'waiting',
        maxPlayers,
        playerCount: 1,
        hostId:      playerId,
        hostName:    playerName,
        createdAt:   Date.now(),
      });
      onDisconnect(lobbyRef).remove();
    }

    // If this tab closes before the game starts, clean up the whole game node
    // (cancelled in startGame once the game is underway).
    onDisconnect(gameRef).remove();
    onDisconnect(ref(rtdb, `games/${gameId}/players/${playerId}/connected`)).set(false);

    currentGameId = gameId;
    enterWaitingRoom(gameId);
  } catch (err) {
    createError.textContent = 'Failed to create game — please try again.';
    createError.classList.remove('hidden');
    console.error('createGame:', err);
  } finally {
    createBtn.disabled = false;
  }
}

// ─── Join game ────────────────────────────────────────────────────────────────

async function joinGame(gameId) {
  if (!gameId) return;

  try {
    // Use a transaction so concurrent joins can't exceed maxPlayers.
    // The callback may run multiple times; keep it pure (no side effects).
    let rejectionReason = null; // set inside the callback to explain aborts
    let alreadyInGame   = false;

    const result = await runTransaction(ref(rtdb, `games/${gameId}`), currentData => {
      // First invocation may receive null before Firebase fetches real data.
      if (currentData === null) return currentData;

      const players = currentData.players ?? {};

      // Already registered (e.g. page refresh) — reconnect without modifying.
      if (players[playerId]) {
        alreadyInGame = true;
        return currentData;
      }

      if (currentData.status !== 'waiting') {
        rejectionReason = 'started';
        return; // abort
      }

      const count = Object.keys(players).length;
      if (count >= currentData.maxPlayers) {
        rejectionReason = 'full';
        return; // abort
      }

      currentData.players = {
        ...players,
        [playerId]: {
          name:      playerName,
          uid:       currentUser?.uid ?? null,
          score:     0,
          connected: true,
        },
      };
      return currentData;
    });

    if (alreadyInGame) {
      // Reconnect path: just mark connected and re-enter the waiting room.
      await update(ref(rtdb, `games/${gameId}/players/${playerId}`), { connected: true });
      onDisconnect(ref(rtdb, `games/${gameId}/players/${playerId}/connected`)).set(false);
      currentGameId = gameId;
      enterWaitingRoom(gameId);
      return;
    }

    if (!result.exists()) {
      showToast('Game not found.');
      return;
    }

    if (!result.committed) {
      if (rejectionReason === 'started') showToast('That game has already started.');
      else if (rejectionReason === 'full') showToast('That game is full.');
      else showToast('Could not join — please try again.');
      return;
    }

    // Transaction committed: update the lobby player count (best-effort) and proceed.
    const newCount = Object.keys(result.val().players).length;
    await update(ref(rtdb, `lobbies/${gameId}`), { playerCount: newCount });

    onDisconnect(ref(rtdb, `games/${gameId}/players/${playerId}/connected`)).set(false);

    currentGameId = gameId;
    enterWaitingRoom(gameId);
  } catch (err) {
    showToast('Failed to join game — please try again.');
    console.error('joinGame:', err);
  }
}

// ─── Waiting room ─────────────────────────────────────────────────────────────

function enterWaitingRoom(gameId) {
  lobbyEntry.classList.add('hidden');
  waitingSection.classList.remove('hidden');

  // Populate shareable link
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('game', gameId);
  linkDisplay.value = url.toString();

  // Listen for real-time updates on this game
  if (unsubGame) unsubGame();
  unsubGame = onValue(ref(rtdb, `games/${gameId}`), snap => {
    if (!snap.exists()) return;
    const game = snap.val();
    renderWaitingRoom(game, gameId);
    if (game.status === 'playing') {
      if (unsubGame) { unsubGame(); unsubGame = null; }
      window.location.href = `multi-play.html?game=${gameId}`;
    }
  });
}

function renderWaitingRoom(game, gameId) {
  const players     = game.players ?? {};
  const playerCount = Object.keys(players).length;
  const iAmHost     = game.hostId === playerId;

  waitingTitle.textContent = `Waiting for Players (${playerCount} / ${game.maxPlayers})`;
  lobbyPrivateNotice.classList.toggle('hidden', !game.isPrivate);

  // Player list
  playerListEl.innerHTML = '';
  Object.entries(players).forEach(([pid, p]) => {
    const card    = document.createElement('div');
    card.className = 'lobby-player-card';

    const initial = (p.name || '?')[0].toUpperCase();
    const tags    = [];
    if (pid === game.hostId) tags.push('host');
    if (pid === playerId)    tags.push('you');
    if (!p.connected)        tags.push('offline');

    card.innerHTML = `
      <div class="lobby-player-avatar">${escHtml(initial)}</div>
      <span class="lobby-player-name">${escHtml(p.name)}</span>
      ${tags.length ? `<span class="lobby-player-tags">${tags.map(t =>
        `<span class="lobby-tag lobby-tag--${t}">${t}</span>`
      ).join('')}</span>` : ''}
    `;
    playerListEl.appendChild(card);
  });

  // Host sees Start button; others see waiting message
  if (iAmHost) {
    startBtn.classList.remove('hidden');
    waitingMsg.classList.add('hidden');
    const ready = playerCount >= game.maxPlayers;
    startBtn.disabled    = !ready;
    startBtn.textContent = ready
      ? 'Start Game'
      : `Waiting for ${game.maxPlayers - playerCount} more…`;
  } else {
    startBtn.classList.add('hidden');
    waitingMsg.classList.remove('hidden');
  }
}

// ─── Start game ───────────────────────────────────────────────────────────────

async function startGame(gameId) {
  startBtn.disabled = true;
  startError.classList.add('hidden');

  try {
    // Cancel the pre-start game-node cleanup now that the game is live
    await onDisconnect(ref(rtdb, `games/${gameId}`)).cancel();
    await update(ref(rtdb, `games/${gameId}`), {
      status:    'playing',
      startedAt: Date.now(),
    });
    // Remove from the public lobby list now that the game is underway
    await remove(ref(rtdb, `lobbies/${gameId}`));
    // All players are redirected by the onValue listener in enterWaitingRoom()
  } catch (err) {
    startError.textContent = 'Failed to start — please try again.';
    startError.classList.remove('hidden');
    startBtn.disabled = false;
    console.error('startGame:', err);
  }
}

// ─── Leave game ───────────────────────────────────────────────────────────────

async function leaveGame(gameId) {
  if (!gameId) return;

  try {
    // Cancel the disconnect hook so leaving doesn't leave a ghost entry
    await onDisconnect(ref(rtdb, `games/${gameId}/players/${playerId}/connected`)).cancel();
    await remove(ref(rtdb, `games/${gameId}/players/${playerId}`));

    // Host leaving: remove the lobby entry entirely
    const gameSnap = await get(ref(rtdb, `games/${gameId}`));
    if (gameSnap.exists() && gameSnap.val().hostId === playerId) {
      await remove(ref(rtdb, `lobbies/${gameId}`));
    } else {
      // Non-host: decrement the lobby player count (or remove if last)
      const lobbySnap = await get(ref(rtdb, `lobbies/${gameId}`));
      if (lobbySnap.exists()) {
        const count = lobbySnap.val().playerCount ?? 1;
        if (count <= 1) {
          await remove(ref(rtdb, `lobbies/${gameId}`));
        } else {
          await update(ref(rtdb, `lobbies/${gameId}`), { playerCount: count - 1 });
        }
      }
    }
  } catch (err) {
    console.error('leaveGame:', err);
  }

  if (unsubGame) { unsubGame(); unsubGame = null; }
  currentGameId = null;

  // Return to entry panel
  waitingSection.classList.add('hidden');
  lobbyEntry.classList.remove('hidden');
  joinCodeInput.value = '';
  // Clear the ?game= param from the URL without a page reload
  const url = new URL(window.location.href);
  url.searchParams.delete('game');
  history.replaceState(null, '', url.toString());

  loadPublicGames();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function copyShareLink() {
  navigator.clipboard.writeText(linkDisplay.value).then(() => {
    copyLinkBtn.textContent = 'Copied!';
    setTimeout(() => { copyLinkBtn.textContent = 'Copy'; }, 2000);
  }).catch(() => {
    // Fallback: select the input so the user can copy manually
    linkDisplay.select();
  });
}

