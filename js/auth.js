/**
 * auth.js — Firebase Authentication for the Set card game.
 *
 * Self-contained module: injects a Sign In button (or user avatar) into the
 * site nav and manages the sign-in / create-account modal.
 *
 */

import {
  onAuthStateChanged,
  signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import { auth } from './firebase-init.js';

const googleProvider = new GoogleAuthProvider();

// ── Friendly error messages ──────────────────────────────────────────────────

function friendlyError(code) {
  const map = {
    'auth/email-already-in-use':   'An account with this email already exists.',
    'auth/wrong-password':         'Incorrect email or password.',
    'auth/invalid-credential':     'Incorrect email or password.',
    'auth/user-not-found':         'No account found with this email.',
    'auth/weak-password':          'Password must be at least 6 characters.',
    'auth/invalid-email':          'Please enter a valid email address.',
    'auth/too-many-requests':      'Too many attempts. Please try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return map[code] ?? 'Something went wrong. Please try again.';
}

// ── Nav widget ───────────────────────────────────────────────────────────────

const nav        = document.querySelector('.site-nav');
const authWidget = document.createElement('div');
authWidget.className = 'auth-widget';
nav.appendChild(authWidget);

function renderNavWidget(user) {
  if (!user) {
    authWidget.innerHTML = `
      <button class="auth-sign-in-btn" data-action="open-modal">Sign In</button>
    `;
  } else {
    const initial     = (user.displayName || user.email || '?')[0].toUpperCase();
    const displayName = user.displayName || user.email;
    authWidget.innerHTML = `
      <div class="auth-avatar" data-action="toggle-dropdown"
           tabindex="0" role="button" aria-haspopup="true" title="${displayName}">
        ${initial}
      </div>
      <div class="auth-dropdown hidden" id="auth-dropdown">
        <div class="auth-dropdown-name">${displayName}</div>
        <button class="btn btn-secondary auth-signout-btn" data-action="signout">
          Sign Out
        </button>
      </div>
    `;
  }
}

// Delegated pointer events on the nav widget (set up once, survives re-renders)
authWidget.addEventListener('pointerdown', async e => {
  e.preventDefault();
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === 'open-modal') {
    openModal('signin');
  } else if (action === 'toggle-dropdown') {
    document.getElementById('auth-dropdown')?.classList.toggle('hidden');
  } else if (action === 'signout') {
    document.getElementById('auth-dropdown')?.classList.add('hidden');
    await signOut(auth);
  }
});

// Keyboard support for avatar (Enter / Space toggles dropdown)
authWidget.addEventListener('keydown', e => {
  const actionEl = e.target.closest('[data-action="toggle-dropdown"]');
  if (actionEl && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    document.getElementById('auth-dropdown')?.classList.toggle('hidden');
  }
});

// Close dropdown when clicking outside the widget
document.addEventListener('pointerdown', e => {
  if (!authWidget.contains(e.target)) {
    document.getElementById('auth-dropdown')?.classList.add('hidden');
  }
});

// ── Auth Modal ───────────────────────────────────────────────────────────────

const GOOGLE_SVG = `
  <svg class="google-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
`;

const overlay = document.createElement('div');
overlay.className = 'modal-overlay hidden';
overlay.id = 'auth-modal-overlay';
overlay.innerHTML = `
  <div class="modal auth-modal" role="dialog" aria-modal="true" aria-label="Sign in">
    <button class="auth-modal-close" id="auth-modal-close" aria-label="Close">&#x2715;</button>

    <div class="auth-tabs" role="tablist">
      <button class="auth-tab active" data-tab="signin" role="tab" aria-selected="true">Sign In</button>
      <button class="auth-tab"        data-tab="create" role="tab" aria-selected="false">Create Account</button>
    </div>

    <!-- Sign In panel -->
    <div class="auth-tab-panel" id="auth-panel-signin" role="tabpanel">
      <button class="btn-google" id="auth-google-signin">
        ${GOOGLE_SVG} Continue with Google
      </button>
      <div class="auth-divider"><span>or</span></div>
      <form class="auth-form" id="auth-signin-form" novalidate>
        <input type="email"    class="auth-input" id="signin-email"    placeholder="Email"    autocomplete="email"            required>
        <input type="password" class="auth-input" id="signin-password" placeholder="Password" autocomplete="current-password" required>
        <div class="auth-error hidden" id="signin-error" aria-live="polite"></div>
        <button type="submit" class="btn btn-primary auth-submit">Sign In</button>
      </form>
      <button class="auth-forgot-link" id="auth-forgot-link">Forgot password?</button>
    </div>

    <!-- Create Account panel -->
    <div class="auth-tab-panel hidden" id="auth-panel-create" role="tabpanel">
      <button class="btn-google" id="auth-google-create">
        ${GOOGLE_SVG} Continue with Google
      </button>
      <div class="auth-divider"><span>or</span></div>
      <form class="auth-form" id="auth-create-form" novalidate>
        <input type="email"    class="auth-input" id="create-email"    placeholder="Email"                 autocomplete="email"       required>
        <input type="password" class="auth-input" id="create-password" placeholder="Password (min 6 chars)" autocomplete="new-password" required>
        <div class="auth-error hidden" id="create-error" aria-live="polite"></div>
        <button type="submit" class="btn btn-primary auth-submit">Create Account</button>
      </form>
    </div>
  </div>
`;
document.body.appendChild(overlay);

// ── Modal open / close ───────────────────────────────────────────────────────

function openModal(tab = 'signin') {
  overlay.classList.remove('hidden');
  switchTab(tab);
  overlay.querySelector(`#auth-panel-${tab} .auth-input`)?.focus();
}

function closeModal() {
  overlay.classList.add('hidden');
  clearErrors();
}

document.getElementById('auth-modal-close').addEventListener('pointerdown', e => {
  e.preventDefault();
  closeModal();
});

overlay.addEventListener('pointerdown', e => {
  if (e.target === overlay) closeModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeModal();
});

// ── Tabs ─────────────────────────────────────────────────────────────────────

function switchTab(tab) {
  overlay.querySelectorAll('.auth-tab').forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });
  overlay.querySelectorAll('.auth-tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `auth-panel-${tab}`);
  });
  clearErrors();
}

overlay.querySelectorAll('.auth-tab').forEach(btn => {
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    switchTab(btn.dataset.tab);
  });
});

// ── Error / success helpers ──────────────────────────────────────────────────

function clearErrors() {
  overlay.querySelectorAll('.auth-error').forEach(el => {
    el.textContent = '';
    el.classList.add('hidden');
    el.classList.remove('auth-success');
  });
}

function showError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.classList.remove('hidden', 'auth-success');
}

function showSuccess(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.classList.remove('hidden');
  el.classList.add('auth-success');
}

// ── Google Sign-In ───────────────────────────────────────────────────────────

async function handleGoogleSignIn(errorId) {
  try {
    await signInWithPopup(auth, googleProvider);
    closeModal();
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user' &&
        err.code !== 'auth/cancelled-popup-request') {
      showError(errorId, friendlyError(err.code));
    }
  }
}

document.getElementById('auth-google-signin').addEventListener('pointerdown', async e => {
  e.preventDefault();
  await handleGoogleSignIn('signin-error');
});

document.getElementById('auth-google-create').addEventListener('pointerdown', async e => {
  e.preventDefault();
  await handleGoogleSignIn('create-error');
});

// ── Email / Password Sign In ─────────────────────────────────────────────────

document.getElementById('auth-signin-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email    = document.getElementById('signin-email').value.trim();
  const password = document.getElementById('signin-password').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    closeModal();
  } catch (err) {
    showError('signin-error', friendlyError(err.code));
  }
});

// ── Email / Password Create Account ─────────────────────────────────────────

document.getElementById('auth-create-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email    = document.getElementById('create-email').value.trim();
  const password = document.getElementById('create-password').value;
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    closeModal();
  } catch (err) {
    showError('create-error', friendlyError(err.code));
  }
});

// ── Forgot Password ──────────────────────────────────────────────────────────

document.getElementById('auth-forgot-link').addEventListener('pointerdown', async e => {
  e.preventDefault();
  const email = document.getElementById('signin-email').value.trim();
  if (!email) {
    showError('signin-error', 'Enter your email above, then click "Forgot password?".');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showSuccess('signin-error', `Password reset email sent to ${email}.`);
  } catch (err) {
    showError('signin-error', friendlyError(err.code));
  }
});

// ── Auth State Listener ──────────────────────────────────────────────────────

onAuthStateChanged(auth, user => {
  renderNavWidget(user);
});

// ── Cross-module sign-in trigger ─────────────────────────────────────────────
// play.js (and any future module) can open the sign-in modal without importing
// auth.js directly by dispatching a 'open-auth-modal' CustomEvent.

document.addEventListener('open-auth-modal', () => openModal('signin'));
