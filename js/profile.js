/**
 * profile.js — User profile page logic.
 *
 * Populates the profile form from the current Firebase user,
 * and handles display name updates via updateProfile().
 */

import {
  onAuthStateChanged,
  updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import { auth } from './firebase-init.js';

const signedInEl  = document.getElementById('profile-signed-in');
const signedOutEl = document.getElementById('profile-signed-out');
const avatarEl    = document.getElementById('profile-avatar-large');
const emailEl     = document.getElementById('profile-email-value');
const nameInput   = document.getElementById('profile-name-input');
const nameForm    = document.getElementById('profile-name-form');
const statusEl    = document.getElementById('profile-name-status');

// ── Auth state ───────────────────────────────────────────────────────────────

onAuthStateChanged(auth, user => {
  if (user) {
    signedInEl.classList.remove('hidden');
    signedOutEl.classList.add('hidden');
    renderProfile(user);
  } else {
    signedInEl.classList.add('hidden');
    signedOutEl.classList.remove('hidden');
  }
});

function renderProfile(user) {
  const initial = (user.displayName || user.email || '?')[0].toUpperCase();
  avatarEl.textContent = initial;
  emailEl.textContent  = user.email;
  nameInput.value      = user.displayName || '';
}

// ── Save name ────────────────────────────────────────────────────────────────

nameForm.addEventListener('submit', async e => {
  e.preventDefault();
  const newName = nameInput.value.trim();

  statusEl.textContent = '';
  statusEl.classList.add('hidden');
  statusEl.classList.remove('auth-success');

  try {
    await updateProfile(auth.currentUser, { displayName: newName || null });

    statusEl.textContent = 'Name saved.';
    statusEl.classList.remove('hidden');
    statusEl.classList.add('auth-success');

    // Reflect updated initial in avatar
    const initial = (newName || auth.currentUser.email || '?')[0].toUpperCase();
    avatarEl.textContent = initial;
  } catch {
    statusEl.textContent = 'Failed to save name. Please try again.';
    statusEl.classList.remove('hidden', 'auth-success');
  }
});

// ── Sign-in button (signed-out state) ────────────────────────────────────────

document.getElementById('profile-sign-in-btn').addEventListener('pointerdown', e => {
  e.preventDefault();
  document.dispatchEvent(new CustomEvent('open-auth-modal'));
});
