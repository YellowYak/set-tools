# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser-based implementation of the card game "Set" — pure vanilla HTML/CSS/ES6 modules, no build step. Firebase provides multiplayer (Realtime Database), auth (Google OAuth + email/password), and game history (Firestore Lite). The solve page's photo-scan feature loads onnxruntime-web and TF.js from CDN (lazily, on first use).

Live: https://set-tools.web.app/

## Running Locally

```bash
python -m http.server
# Open http://localhost:8000
```

Any static HTTP server works (`npx serve`, VS Code Live Server, etc.). The `file://` protocol does **not** work due to ES6 module CORS restrictions.

## Deployment

```bash
firebase deploy
```

## Architecture

### Pages → JS Modules

| Page | Module | Purpose |
|------|--------|---------|
| `play.html` | `js/play.js` | Single-player and vs-Computer game loop |
| `multi-play.html` | `js/multi-play.js` | Multiplayer board with RTDB real-time sync |
| `lobby.html` | `js/lobby.js` | Multiplayer lobby (create/join) |
| `solve.html` | `js/solve.js` | Interactive Set solver tool |
| `profile.html` | `js/profile.js` | User profile management |
| `history.html` | `js/history.js` | Game history with pagination |

### Core Modules (no Firebase dependencies)

- **`js/deck.js`** — Card model, `createDeck()`, `shuffle()`. Cards are plain objects: `{ color, shape, count, fill }`.
- **`js/set-logic.js`** — `isSet()`, `findAllSets()`, `hasSet()`. Pure functions; these are the game's source of truth.
- **`js/card-render.js`** — `createCardEl()`, `renderSetList()`. Renders cards as SVG-based DOM elements.
- **`js/utils.js`** — `showToast()`, `dealInCard()`, `escHtml()`.
- **`js/image-recognize.js`** — Photo-scan pipeline: YOLOv8 OBB card detection (`models/best.onnx` via onnxruntime-web) + MobileNetV2 multi-head classifier (`models/model.json` via TF.js) that returns color/shape/fill/count for each detected card.

### Firebase Modules

- **`js/firebase-init.js`** — Singleton exports: `app`, `auth`, `rtdb`. Firebase config is intentionally public (client-side app).
- **`js/db.js`** — Firestore Lite helpers: `saveGame()`, `saveMultiplayerGame()`.
- **`js/auth.js`** — Auth UI widget (sign-in modal, state change listeners).
- **`js/guest-identity.js`** — Guest players use a UUID persisted in `localStorage` (`guest_{16hex}`).

### CSS

`css/style.css` is a single monolithic stylesheet (~37KB). SVG shapes (oval, diamond, squiggle) and hatch patterns for striped fill are defined inline in HTML `<defs>` blocks.

## Key Patterns

**Multiplayer concurrency:** Board state is stored in RTDB as `shuffledIndices` (a permutation of 0–80 indices into the deterministic `createDeck()` output), not as card objects. All clients independently reconstruct the same deck. RTDB transactions are used for atomic Set claims.

**Card DOM attributes:** Cards carry `data-*` attributes for all four Set properties. Selection state is tracked via CSS class `.selected`.

**Animation:** Deal-in uses CSS keyframes with staggered JS timing. The fly-to-score effect clones the card element, positions it fixed, transitions it, then removes it.

**Input:** Pointer events (not separate mouse/touch) everywhere. Cards have `tabindex="0"` and keyboard handlers for accessibility.

**Firestore Lite vs full SDK:** The Lite SDK (REST-only) was chosen specifically to avoid WebChannel compatibility issues with privacy browser extensions.

## Firebase Services

| Service | Use |
|---------|-----|
| Authentication | Google OAuth + email/password |
| Realtime Database | Multiplayer game state at `/games/{gameId}` |
| Firestore Lite | Game history at `/games` collection (signed-in users only) |

Security rules in `database.rules.json` use data shape validation for RTDB writes (guests are not Firebase Auth users, so per-user auth enforcement is not currently possible).

## Branch Conventions

- `main` — production (deployed to Firebase Hosting)
- `develop` — active development
