/**
 * guest-identity.js — Persistent player identity for multiplayer.
 *
 * Signed-in users are identified by their Firebase Auth uid and display name.
 * Guests get a randomly-generated id and a display name stored in localStorage,
 * so their identity persists across page loads within the same browser.
 */

const KEY_ID   = 'mp_guest_id';
const KEY_NAME = 'mp_guest_name';

/**
 * Returns the persistent guest id for this browser, generating one if needed.
 * Format: "guest_{16 lowercase hex chars}"
 * @returns {string}
 */
export function getGuestId() {
  let id = localStorage.getItem(KEY_ID);
  if (!id) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    id = 'guest_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(KEY_ID, id);
  }
  return id;
}

/**
 * Returns the guest display name stored in localStorage, or null if not set.
 * @returns {string|null}
 */
export function getGuestName() {
  return localStorage.getItem(KEY_NAME);
}

/**
 * Saves a display name to localStorage (max 24 chars, matching the HTML input).
 * @param {string} name
 */
export function setGuestName(name) {
  localStorage.setItem(KEY_NAME, name.trim().slice(0, 24));
}

/**
 * Clears the guest id and name from localStorage.
 * Call this when a user signs in so stale guest identity doesn't resurface on sign-out.
 */
export function clearGuestIdentity() {
  localStorage.removeItem(KEY_ID);
  localStorage.removeItem(KEY_NAME);
}

/**
 * Returns the effective player id:
 *   - signed-in user → their Firebase uid
 *   - guest          → persistent guest_ id from localStorage
 * @param {import('firebase/auth').User|null} user
 * @returns {string}
 */
export function getPlayerId(user) {
  return user ? user.uid : getGuestId();
}

/**
 * Returns the effective display name:
 *   - signed-in user → displayName, falling back to email prefix
 *   - guest          → stored guest name, falling back to 'Guest'
 * @param {import('firebase/auth').User|null} user
 * @returns {string}
 */
export function getDisplayName(user) {
  if (user) {
    return user.displayName || user.email?.split('@')[0] || 'Player';
  }
  return getGuestName() || 'Guest';
}
