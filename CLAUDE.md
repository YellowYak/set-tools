# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Project

The game uses ES6 modules and must be served over HTTP (not opened as a `file://` URL):

```bash
python -m http.server
# then open http://localhost:8000
```

Any static file server works (VS Code Live Server, `npx serve`, etc.). There is no build step, no npm, and no dependencies.

## Architecture

This is a vanilla JS single-page app split across three HTML pages, each loading one JS entry point as a `type="module"` script. There is no bundler, framework, or test suite.

**Module dependency graph:**
```
play.js  ──┐
solve.js ──┼──► deck.js        (card data model: createDeck, shuffle)
           ├──► set-logic.js   (isSet, findAllSets, hasSet)
           └──► card-render.js (createCardEl — pure DOM, no events)
```

**Card data model:** Cards are plain objects `{ color, shape, count, fill }` using the string/number values defined in `deck.js`. The full 81-card deck is the Cartesian product of 3 colors × 3 shapes × 3 counts × 3 fills.

**SVG rendering:** Each HTML page contains an inline `<svg><defs>` block defining the three shape paths (`#oval`, `#diamond`, `#squiggle`) and three hatch fill patterns (`#hatch-red`, `#hatch-green`, `#hatch-purple`). `card-render.js` references these by ID via `<use href="#shape">`. **Any new page that renders cards must include this SVG defs block.**

**play.js state:** `deck` (remaining cards), `board` (parallel to `#board` DOM children — indices must stay in sync), `selected` (board indices of selected cards, max 3), `busy` (blocks input during animations), and hint state (`hintStep`, `hintSetIndices`). The `board` array and `#board` DOM children are kept strictly parallel; functions like `removeCards` sort indices high-to-low before splicing to preserve lower indices.

**Animation patterns:**
- Deal-in: add class `dealing` with `animationDelay`, remove on `animationend`
- Fly-to-score: clone card at fixed position → double-RAF to trigger CSS transition → `setTimeout` cleanup. The double-`requestAnimationFrame` pattern is intentional — it lets the browser register the element at its start position before triggering the transition.
- `busy = true` gates all user input during animations.

**solve.js state:** `allCards` is the canonical 81-card array in a fixed order. `boardIndices` is a `Set<number>` of indices into `allCards`. The picker always shows all 81 cards; `on-board` CSS class marks which are selected.

## Key Constraints

- No build tools, no npm. Do not add a package.json or bundler.
- All styling lives in `css/style.css`. Card dimensions scale via CSS custom properties at three breakpoints.
- Input uses `pointerdown` (not `click`) to handle both mouse and touch uniformly; `e.preventDefault()` suppresses the synthetic mouse event on touch devices.
- `set-logic.js` has no DOM dependencies and can be tested in isolation with Node.js if needed.

## UI/Animation Guidelines

After completing feature implementations, always run a visual check by describing what the user should see — especially for animations, styling, and layout changes. Flag if cloned/hidden elements might cause visual glitches.

## Git Workflow

When asked to commit and push, always:

1) `git add` relevant files,
2) Write a descriptive commit message,
3) Push to current branch,
4) Report the commit hash.

If a PR is requested, create it immediately after pushing.
