# Set — Card Game

A standalone browser implementation of the card game **Set**, built with vanilla HTML, CSS, and JavaScript. No frameworks, no build tools, no dependencies.

## Playing

### Online

Live demo available at https://set-card-game-ddd65.web.app/

### Locally

Open `index.html` in a browser. Because the game uses ES6 modules, it must be served over HTTP rather than opened as a `file://` URL. A one-liner from the project root works fine:

```bash
python -m http.server
# then open http://localhost:8000
```

Any static file server will do (VS Code Live Server, `npx serve`, etc.).

## Pages

| Page | Description |
|---|---|
| `index.html` | Landing page with rules summary and navigation |
| `play.html` | Play the game — single player or vs Computer, full game loop |
| `solve.html` | Board builder and Set solver — add any cards, find all Sets |
| `profile.html` | User profile — edit display name, change password (email/password accounts) |
| `history.html` | Game history — paginated, filterable, sortable table of past games with aggregate stats |

## The Game

Set is played with a deck of **81 unique cards**. Each card has four features:

| Feature | Values |
|---|---|
| Color | Red · Green · Purple |
| Shape | Oval · Diamond · Squiggle |
| Count | 1 · 2 · 3 |
| Fill | Solid · Striped · Open |

A **Set** is any three cards where, for each of the four features, the values across the three cards are either *all the same* or *all different*. No feature may have two matching and one different.

**Standard play:** 12 cards are dealt face-up. Find a Set, select those three cards — they're removed and replaced from the deck. If no Set exists on the board, three extra cards are added. The game ends when the deck is exhausted and no Sets remain.

## Features

### Authentication (all pages)
- **Sign In** button in the nav on every page — anonymous play is always available with no account required
- **Google Sign-In** — one-click OAuth via Google
- **Email / Password** — create an account or sign in with an email address
- Signed-in users see their initial in a circular avatar; clicking it opens a dropdown with their name and a Sign Out option
- **Forgot password** — enter your email on the Sign In tab and click the link to receive a reset email
- **Profile page** — signed-in users can edit their display name; email/password accounts can also change their password (requires re-authentication with the current password)
- Auth state persists across page navigations and browser sessions (managed by Firebase)

### Play page

**Game modes** — chosen at the start of every game:
- **Single Player** — play at your own pace, finding Sets until the deck runs out
- **vs Computer** — race the computer to find Sets; choose a difficulty level:
  | Difficulty | Computer response time |
  |---|---|
  | Easy | 10–30 seconds |
  | Medium | 7.5–20 seconds |
  | Hard | 5–15 seconds |
  | Genius | 2–8 seconds |

  The computer waits a random duration (within the range for the chosen difficulty) then claims a Set if the player hasn't found one first. Each round uses a fresh random delay. The computer's score card shows the active difficulty level.

**Score panel** — Player 1 score on the left, elapsed time centered, Computer score on the right (vs Computer mode only).

- Click or tap cards to select them; the third selection triggers immediate validation
- Valid Set: cards animate off the board and fly to the scoring player's score card
- Invalid Set: cards flash red and deselect
- New replacement cards deal in from off-screen with a staggered animation
- **Hint system** *(single player only)* — progressive, one card revealed per click:
  - 1st click: one card from a valid Set is highlighted
  - 2nd click: a second card from the same Set
  - 3rd click: the third card
  - Further clicks: reminder that all three are shown
  - Hint resets automatically when a Set is completed
- **All Sets** *(single player only)* — button opens an overlay listing every valid Set on the current board as mini-card triplets (click outside or press Escape to close)
- **Pause** — freezes the timer and the computer's countdown; an opaque overlay hides the board. Resume by clicking the Resume button or pressing Escape
- **Timer** counts up from 0:00 when the game starts and freezes when the game ends
- Status bar shows cards remaining in deck, cards on board, and Sets currently present
- Game-over modal shows result and stats for both modes — vs Computer: winner, scores, mistakes, and per-set timing; single player: sets found, time, hints, mistakes, and per-set timing; includes "← Home" link to return to the landing page without starting a new game
- New Game modal also includes a "← Home" link for easy navigation before a game begins
- **Game history** — signed-in users have their completed game saved automatically; guests see a gentle "Sign in to save" nudge with a one-click sign-in button. If a guest signs in directly from the game-over modal, the just-completed game is saved retroactively

### Solve page
- Browse all 81 cards in a scrollable picker; click any card to add/remove it from the board
- **Deal 12 Random** — populate the board instantly for quick practice
- **Find All Sets** — exhaustive search; results shown as grouped mini-card triplets
- **Clear Board** — reset to an empty board

## Project Structure

```
/
├── index.html              Landing page
├── play.html               Game page
├── solve.html              Solver page
├── profile.html            User profile page
├── firebase.json           Firebase Hosting configuration
├── .firebaserc             Firebase project alias (set-card-game-ddd65)
├── .gitignore              Ignores local Firebase cache (.firebase/)
├── css/
│   └── style.css           All styles — layout, card states, animations
├── js/
│   ├── deck.js             Card data model, createDeck(), shuffle()
│   ├── set-logic.js        isSet(), findAllSets(), hasSet()
│   ├── card-render.js      createCardEl(), renderSetList() — DOM card builders
│   ├── play.js             Game loop, animations, hint system
│   ├── solve.js            Board builder and solver UI
│   ├── auth.js             Firebase Authentication — sign-in widget and modal
│   ├── profile.js          Profile page — display name and password updates
│   ├── history.js          History page — loads, filters, sorts, and paginates game records
│   ├── firebase-init.js    Firebase app singleton (shared by auth.js and db.js)
│   └── db.js               Firestore helpers — saveGame() and getGames()
└── assets/
    └── set-card-prototype.html   Visual reference for SVG shapes and fills
```

## Technical Notes

- **Firebase Authentication + Firestore** — loaded via the official Firebase CDN ESM; no bundler needed. Firestore uses the Lite SDK (`firebase-firestore-lite`) which issues plain REST requests rather than a WebChannel, avoiding compatibility issues with browser privacy extensions
- **No other dependencies** — vanilla ES6 modules (`type="module"`), no npm, no build step
- **SVG card rendering** — shapes (`#oval`, `#diamond`, `#squiggle`) and hatch fill patterns (`#hatch-red`, `#hatch-green`, `#hatch-purple`) are defined once per page in an inline `<svg><defs>` block; cards reference them with `<use href="#shape">`
- **Card DOM structure** — each card is a `<div class="card">` with `data-color`, `data-shape`, `data-count`, `data-fill` attributes and an `aria-label` (e.g. `"2 red striped ovals"`)
- **Animations** — CSS keyframes for deal-in (`fill-mode: both` prevents flash-before-animation); JS clone trick for fly-to-score (snapshot position → fixed-position clone → CSS transition → remove)
- **Input** — pointer events handle both mouse and touch uniformly
- **Mobile-first** — card dimensions scale via CSS custom properties at three breakpoints
