/**
 * history.js — Game history page logic.
 *
 * Fetches the signed-in user's game records from Firestore,
 * displays a summary panel of aggregate stats, and renders
 * a paginated table of games with expandable detail rows.
 * All filtering is client-side against the in-memory allGames array.
 */

import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import { auth } from './firebase-init.js';
import { getGames } from './db.js';
import { escHtml } from './utils.js';

const PAGE_SIZE = 10;

let allGames      = [];
let filteredGames = [];
let currentPage   = 0;

const filters = {
  mode:    'all',  // 'all' | 'solo' | 'vs-computer'
  outcome: 'all',  // 'all' | 'win' | 'loss' | 'tie'
};

const sortState = {
  column:    'completedAt',  // matches data-sort attribute values
  direction: 'desc',         // 'asc' | 'desc'
};

// Numeric/date columns default to descending when first clicked (largest first).
const DESCENDING_DEFAULT_COLS = new Set(['completedAt', 'durationMs', 'playerSets']);

// ── DOM refs ─────────────────────────────────────────────────────────────────

const loadingEl      = document.getElementById('history-loading');
const signedInEl     = document.getElementById('history-signed-in');
const signedOutEl    = document.getElementById('history-signed-out');
const emptyEl        = document.getElementById('history-empty');
const noResultsEl    = document.getElementById('history-no-results');
const tableWrapperEl = document.getElementById('history-table-wrapper');
const summaryEl      = document.getElementById('history-summary-panel');
const tbodyEl        = document.getElementById('history-tbody');
const prevBtn        = document.getElementById('history-prev');
const nextBtn        = document.getElementById('history-next');
const pageLabelEl    = document.getElementById('history-page-label');
const paginationEl   = document.getElementById('history-pagination');
const outcomeGroupEl = document.getElementById('filter-outcome-group');

// ── Auth state ────────────────────────────────────────────────────────────────

onAuthStateChanged(auth, user => {
  if (user) {
    showOnly(loadingEl);
    loadHistory(user.uid);
  } else {
    showOnly(signedOutEl);
  }
});

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadHistory(uid) {
  try {
    allGames = await getGames(uid);

    if (allGames.length === 0) {
      showOnly(emptyEl);
      return;
    }

    applyFilters();
    updateSortIndicators();
    showOnly(signedInEl);
  } catch (err) {
    // Surface the Firebase index-creation URL in the console so the developer
    // can click it to set up the required composite index the first time.
    console.error('Failed to load game history:', err);
    const p = loadingEl.querySelector('p');
    p.textContent = 'Failed to load game history. Check the browser console for details.';
    p.classList.add('history-load-error');
  }
}

// ── Sorting ───────────────────────────────────────────────────────────────────

function sortedGames(games) {
  const { column, direction } = sortState;
  return [...games].sort((a, b) => {
    let av = a[column];
    let bv = b[column];

    // Nullish values (e.g. Solo games with no outcome) move with the sort:
    // end on ascending, beginning on descending.
    if (av == null && bv == null) return 0;
    if (av == null) return direction === 'asc' ?  1 : -1;
    if (bv == null) return direction === 'asc' ? -1 :  1;

    // Firestore Lite timestamps → numeric seconds for comparison
    if (column === 'completedAt') {
      av = av.seconds ?? 0;
      bv = bv.seconds ?? 0;
    }

    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return direction === 'asc' ? cmp : -cmp;
  });
}

function updateSortIndicators() {
  document.querySelectorAll('#history-table th[data-sort]').forEach(th => {
    const isActive = th.dataset.sort === sortState.column;
    th.classList.toggle('sort-active', isActive);
    th.setAttribute('aria-sort',
      isActive ? (sortState.direction === 'asc' ? 'ascending' : 'descending') : 'none');
  });
}

// ── Filtering ─────────────────────────────────────────────────────────────────

function applyFilters() {
  const filtered = allGames.filter(game => {
    if (filters.mode !== 'all' && game.gameMode !== filters.mode) return false;
    if (filters.outcome !== 'all' && game.outcome !== filters.outcome) return false;
    return true;
  });

  filteredGames = sortedGames(filtered);
  currentPage = 0;
  renderSummary();
  renderPage(0);
}

// ── Filter pill interaction ───────────────────────────────────────────────────

document.getElementById('history-filters').addEventListener('pointerdown', e => {
  e.preventDefault();
  const pill = e.target.closest('.filter-pill');
  if (!pill) return;

  const dimension = pill.dataset.filter;
  const value     = pill.dataset.value;

  filters[dimension] = value;

  // Mark active pill within this group
  pill.closest('.filter-pills').querySelectorAll('.filter-pill').forEach(p => {
    p.classList.toggle('active', p === pill);
  });

  // Outcome is irrelevant for solo-only view: hide it and reset to 'all'
  if (dimension === 'mode') {
    if (value === 'solo') {
      filters.outcome = 'all';
      outcomeGroupEl.querySelectorAll('.filter-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.value === 'all');
      });
      outcomeGroupEl.classList.add('hidden');
    } else {
      outcomeGroupEl.classList.remove('hidden');
    }
  }

  applyFilters();
});

// ── Summary stats ─────────────────────────────────────────────────────────────

function renderSummary() {
  const games = filteredGames;
  const total = games.length;

  if (total === 0) {
    summaryEl.innerHTML = '';
    return;
  }

  const vsComp = games.filter(g => g.gameMode === 'vs-computer');
  const multi  = games.filter(g => g.gameMode === 'multiplayer');

  const cpuWins   = vsComp.filter(g => g.outcome === 'win').length;
  const cpuLosses = vsComp.filter(g => g.outcome === 'loss').length;
  const cpuTies   = vsComp.filter(g => g.outcome === 'tie').length;

  const multiWins   = multi.filter(g => g.outcome === 'win').length;
  const multiLosses = multi.filter(g => g.outcome === 'loss').length;
  const multiTies   = multi.filter(g => g.outcome === 'tie').length;

  const avgDurationMs = games.reduce((s, g) => s + (g.durationMs || 0), 0) / total;
  const setTimesAll   = games.flatMap(g => g.setTimesMs || []);
  const avgSetMs      = setTimesAll.length
    ? setTimesAll.reduce((s, t) => s + t, 0) / setTimesAll.length
    : null;

  const stats = [{ label: 'Games', value: total }];

  if (filters.mode === 'all') {
    const solo = games.filter(g => g.gameMode === 'solo').length;
    stats.push({ label: 'Solo',  value: solo });
    stats.push({ label: 'Multi', value: multi.length });
    stats.push({ label: 'vs CPU', value: `${cpuWins}W / ${cpuLosses}L / ${cpuTies}T` });
  } else if (filters.mode === 'vs-computer') {
    stats.push({ label: 'W / L / T', value: `${cpuWins} / ${cpuLosses} / ${cpuTies}` });
  } else if (filters.mode === 'multiplayer') {
    stats.push({ label: 'W / L / T', value: `${multiWins} / ${multiLosses} / ${multiTies}` });
  }

  stats.push({ label: 'Avg Duration', value: formatDuration(avgDurationMs) });
  if (filters.mode !== 'multiplayer') {
    stats.push({ label: 'Avg Set Time', value: avgSetMs !== null ? formatMs(avgSetMs) : '—' });
  }

  summaryEl.innerHTML = stats.map(s => `
    <div class="summary-stat">
      <div class="summary-stat-value">${s.value}</div>
      <div class="summary-stat-label">${s.label}</div>
    </div>
  `).join('');
}

// ── Table rendering ───────────────────────────────────────────────────────────

function renderPage(page) {
  const hasResults = filteredGames.length > 0;

  noResultsEl.classList.toggle('hidden', hasResults);
  tableWrapperEl.classList.toggle('hidden', !hasResults);

  if (!hasResults) return;

  currentPage = page;
  const totalPages = Math.ceil(filteredGames.length / PAGE_SIZE);

  paginationEl.classList.toggle('hidden', totalPages <= 1);
  const start      = page * PAGE_SIZE;
  const pageGames  = filteredGames.slice(start, start + PAGE_SIZE);

  tbodyEl.innerHTML = '';
  pageGames.forEach((game, i) => {
    const rowIndex = start + i;

    // ── Summary row ──
    const summaryRow = document.createElement('tr');
    summaryRow.className = 'history-row';
    summaryRow.dataset.index = rowIndex;
    summaryRow.innerHTML = `
      <td class="col-chevron" aria-hidden="true">▶</td>
      <td class="col-date">${formatDate(game.completedAt)}</td>
      <td class="col-mode">${formatMode(game)}</td>
      <td class="col-duration">${formatDuration(game.durationMs)}</td>
      <td class="col-sets">${game.playerSets ?? '—'}</td>
      <td class="col-outcome">${outcomeCell(game)}</td>
    `;

    // ── Detail row ──
    const isMulti = game.gameMode === 'multiplayer';
    const detailRow = document.createElement('tr');
    detailRow.className = 'history-detail hidden';
    detailRow.innerHTML = `
      <td colspan="6">
        <dl class="history-detail-grid">
          ${isMulti && game.opponents?.length ? `
            <div><dt>Opponents</dt><dd>${game.opponents.map(o => `${escHtml(o.name)} (${o.score})`).join(', ')}</dd></div>
          ` : ''}
          ${game.gameMode === 'vs-computer' ? `<div><dt>Computer Sets</dt><dd>${game.computerSets ?? '—'}</dd></div>` : ''}
          ${game.gameMode === 'solo' ? `<div><dt>Hints Used</dt><dd>${game.hintsUsed ?? 0}</dd></div>` : ''}
          ${!isMulti ? `<div><dt>Mistakes</dt><dd>${game.mistakeCount ?? 0}</dd></div>` : ''}
          ${!isMulti ? `<div><dt>Extra Cards Dealt</dt><dd>${game.extraCardsDealt ?? 0}</dd></div>` : ''}
          ${!isMulti ? `<div><dt>Avg Set Time</dt><dd>${game.avgSetTimeMs != null ? formatMs(game.avgSetTimeMs) : '—'}</dd></div>` : ''}
          ${!isMulti ? `<div><dt>Fastest Set</dt><dd>${game.fastestSetMs != null ? formatMs(game.fastestSetMs) : '—'}</dd></div>` : ''}
          ${!isMulti ? `<div><dt>Slowest Set</dt><dd>${game.slowestSetMs != null ? formatMs(game.slowestSetMs) : '—'}</dd></div>` : ''}
        </dl>
      </td>
    `;

    summaryRow.addEventListener('pointerdown', e => {
      e.preventDefault();
      const isExpanded = !detailRow.classList.contains('hidden');
      detailRow.classList.toggle('hidden', isExpanded);
      summaryRow.querySelector('.col-chevron').textContent = isExpanded ? '▶' : '▼';
      summaryRow.classList.toggle('expanded', !isExpanded);
    });

    tbodyEl.appendChild(summaryRow);
    tbodyEl.appendChild(detailRow);
  });

  // Pagination controls
  prevBtn.disabled        = page === 0;
  nextBtn.disabled        = page >= totalPages - 1;
  pageLabelEl.textContent = `Page ${page + 1} of ${totalPages}`;
}

// ── Column sort ───────────────────────────────────────────────────────────────

document.querySelector('#history-table thead').addEventListener('pointerdown', e => {
  e.preventDefault();
  const th = e.target.closest('th[data-sort]');
  if (!th) return;

  const column = th.dataset.sort;
  if (sortState.column === column) {
    sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
  } else {
    sortState.column    = column;
    sortState.direction = DESCENDING_DEFAULT_COLS.has(column) ? 'desc' : 'asc';
  }

  updateSortIndicators();
  filteredGames = sortedGames(filteredGames);
  currentPage   = 0;
  renderPage(0);
});

// ── Pagination buttons ────────────────────────────────────────────────────────

prevBtn.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (currentPage > 0) renderPage(currentPage - 1);
});

nextBtn.addEventListener('pointerdown', e => {
  e.preventDefault();
  const totalPages = Math.ceil(filteredGames.length / PAGE_SIZE);
  if (currentPage < totalPages - 1) renderPage(currentPage + 1);
});

// ── Sign-in button (signed-out state) ─────────────────────────────────────────

document.getElementById('history-sign-in-btn').addEventListener('pointerdown', e => {
  e.preventDefault();
  document.dispatchEvent(new CustomEvent('open-auth-modal'));
});

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatDuration(ms) {
  if (ms == null) return '—';
  const totalSec = Math.round(ms / 1000);
  const min      = Math.floor(totalSec / 60);
  const sec      = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function formatMs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(timestamp) {
  if (!timestamp) return '—';
  // Firestore Lite returns a plain object with seconds/nanoseconds
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatMode(game) {
  if (game.gameMode === 'solo') return 'Solo';
  if (game.gameMode === 'multiplayer') return `Multi (${game.playerCount ?? '?'}p)`;
  const diff = game.difficulty
    ? game.difficulty.charAt(0).toUpperCase() + game.difficulty.slice(1)
    : '';
  return diff ? `vs CPU (${diff})` : 'vs CPU';
}

function outcomeCell(game) {
  if (game.gameMode === 'solo') return '<span class="outcome-none">—</span>';
  const map = {
    win:  '<span class="outcome-badge outcome-win">Win</span>',
    loss: '<span class="outcome-badge outcome-loss">Loss</span>',
    tie:  '<span class="outcome-badge outcome-tie">Tie</span>',
  };
  return map[game.outcome] ?? '<span class="outcome-none">—</span>';
}

// ── Utility ───────────────────────────────────────────────────────────────────

function showOnly(el) {
  [loadingEl, signedInEl, signedOutEl, emptyEl].forEach(e => e.classList.add('hidden'));
  el.classList.remove('hidden');
}

