/**
 * utils.js — Shared UI helpers used across multiple pages.
 */

/**
 * Display a brief toast notification at the bottom of the screen.
 * @param {string} message
 * @param {number} duration  ms before the toast fades out
 */
export function showToast(message, duration = 2800) {
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

/**
 * Apply the deal-in CSS animation to a card element.
 * @param {HTMLElement} el
 * @param {number} delayMs
 */
export function dealInCard(el, delayMs) {
  el.style.animationDelay = `${delayMs}ms`;
  el.classList.add('dealing');
  el.addEventListener('animationend', () => {
    el.classList.remove('dealing');
    el.style.animationDelay = '';
  }, { once: true });
}

/**
 * Returns a random CSS rotation between -2 and +2 degrees (2 decimal places).
 * Used to give dealt cards a subtle randomised tilt.
 * @returns {string}  e.g. "1.23deg"
 */
export function randomRotation() {
  return (Math.random() * 4 - 2).toFixed(2) + 'deg';
}

/**
 * Escape a string for safe insertion into HTML.
 * @param {*} str
 * @returns {string}
 */
export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
