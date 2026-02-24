/**
 * profile.js — User profile page logic.
 *
 * Populates the profile form from the current Firebase user,
 * and handles display name updates via updateProfile().
 * For email/password users, also handles password changes.
 */

import {
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import { auth } from './firebase-init.js';

const signedInEl  = document.getElementById('profile-signed-in');
const signedOutEl = document.getElementById('profile-signed-out');
const avatarEl    = document.getElementById('profile-avatar-large');
const emailEl     = document.getElementById('profile-email-value');
const nameInput   = document.getElementById('profile-name-input');
const nameForm    = document.getElementById('profile-name-form');
const statusEl    = document.getElementById('profile-name-status');

const passwordSection  = document.getElementById('profile-password-section');
const dividerEl        = document.getElementById('profile-divider');
const passwordForm     = document.getElementById('profile-password-form');
const currentPwInput   = document.getElementById('profile-current-password');
const newPwInput       = document.getElementById('profile-new-password');
const passwordStatusEl = document.getElementById('profile-password-status');

const FRIENDLY_PW_ERRORS = {
  'auth/wrong-password':         'Current password is incorrect.',
  'auth/invalid-credential':     'Current password is incorrect.',
  'auth/weak-password':          'New password must be at least 6 characters.',
  'auth/too-many-requests':      'Too many attempts. Please try again later.',
  'auth/network-request-failed': 'Network error. Check your connection.',
};

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

  const isPasswordUser = user.providerData.some(p => p.providerId === 'password');
  passwordSection.classList.toggle('hidden', !isPasswordUser);
  dividerEl.classList.toggle('hidden', !isPasswordUser);
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

// ── Change password ──────────────────────────────────────────────────────────

passwordForm.addEventListener('submit', async e => {
  e.preventDefault();
  const currentPw = currentPwInput.value;
  const newPw     = newPwInput.value.trim();

  passwordStatusEl.textContent = '';
  passwordStatusEl.classList.add('hidden');
  passwordStatusEl.classList.remove('auth-success');

  if (newPw.length < 6) {
    passwordStatusEl.textContent = 'New password must be at least 6 characters.';
    passwordStatusEl.classList.remove('hidden');
    return;
  }

  try {
    const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPw);
    await reauthenticateWithCredential(auth.currentUser, credential);
    await updatePassword(auth.currentUser, newPw);

    passwordStatusEl.textContent = 'Password updated.';
    passwordStatusEl.classList.remove('hidden');
    passwordStatusEl.classList.add('auth-success');
    passwordForm.reset();
  } catch (err) {
    passwordStatusEl.textContent =
      FRIENDLY_PW_ERRORS[err.code] ?? 'Something went wrong. Please try again.';
    passwordStatusEl.classList.remove('hidden');
  }
});

// ── Sign-in button (signed-out state) ────────────────────────────────────────

document.getElementById('profile-sign-in-btn').addEventListener('pointerdown', e => {
  e.preventDefault();
  document.dispatchEvent(new CustomEvent('open-auth-modal'));
});
