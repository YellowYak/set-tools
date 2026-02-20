# Set — Card Game

A standalone browser implementation of the card game **Set**, built with vanilla HTML, CSS, and JavaScript. No frameworks, no build tools, no dependencies.

## Playing

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
| `play.html` | Play the game — single player, full game loop |
| `solve.html` | Board builder and Set solver — add any cards, find all Sets |

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

### Play page
- Click or tap cards to select them; the third selection triggers immediate validation
- Valid Set: cards animate off the board and fly to the score panel
- Invalid Set: cards flash red and deselect
- New replacement cards deal in from off-screen with a staggered animation
- **Hint system** — progressive, one card revealed per click:
  - 1st click: one card from a valid Set is highlighted
  - 2nd click: a second card from the same Set
  - 3rd click: the third card
  - Further clicks: reminder that all three are shown
  - Hint resets automatically when a Set is completed
- **All Sets** button opens an overlay listing every valid Set on the current board as mini-card triplets (click outside or press Escape to close)
- Status bar shows cards remaining in deck, cards on board, and Sets currently present
- Game-over summary modal when the deck is exhausted

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
├── css/
│   └── style.css           All styles — layout, card states, animations
├── js/
│   ├── deck.js             Card data model, createDeck(), shuffle()
│   ├── set-logic.js        isSet(), findAllSets(), hasSet()
│   ├── card-render.js      createCardEl() — DOM card builder
│   ├── play.js             Game loop, animations, hint system
│   └── solve.js            Board builder and solver UI
└── assets/
    └── set-card-prototype.html   Visual reference for SVG shapes and fills
```

## Technical Notes

- **No dependencies** — vanilla ES6 modules (`type="module"`), no npm, no build step
- **SVG card rendering** — shapes (`#oval`, `#diamond`, `#squiggle`) and hatch fill patterns (`#hatch-red`, `#hatch-green`, `#hatch-purple`) are defined once per page in an inline `<svg><defs>` block; cards reference them with `<use href="#shape">`
- **Card DOM structure** — each card is a `<div class="card">` with `data-color`, `data-shape`, `data-count`, `data-fill` attributes and an `aria-label` (e.g. `"2 red striped ovals"`)
- **Animations** — CSS keyframes for deal-in (`fill-mode: both` prevents flash-before-animation); JS clone trick for fly-to-score (snapshot position → fixed-position clone → CSS transition → remove)
- **Input** — pointer events handle both mouse and touch uniformly
- **Mobile-first** — card dimensions scale via CSS custom properties at three breakpoints
