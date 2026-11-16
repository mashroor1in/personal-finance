# Bucksy — brand assets (Forest Finance)

The supplied brand board is the **source of truth** for the Bucksy identity.
Nothing here is invented: colours, type, sizes and copy are transcribed from it.
This folder keeps the pack as delivered, and adds the vector derivatives the
website needs (the delivered primary mark is raster).

## Start here

| File | What it is |
|---|---|
| `brand-board.html` | The full brand board. Open in a browser. |
| `exports/bucksy-brand-board-preview.png` | Static preview of the board (1600×1200). |
| `reference/bucksy-brand-board-reference.webp` | The original visual reference, unchanged. |
| `tokens.css` | Palette + type + roles as CSS, with a commented drop-in map for `app.html`. |

## The identity, transcribed

- **Palette** — Pine `#0B3D2E`, Fern `#18815A`, Sage `#A8D5B2`, Amber `#F7931A`,
  Cream `#F9F6EE`, Stone `#E6E1D7`, Ink `#102F27`. Logo-only greens: Leaf
  `#79C94A`, Deep Fern `#078B4F`.
- **Typeface** — Inter (400/500/600/700/800). Wordmark: 800, tracking −0.075em.
  Tagline: 600, tracking 0.23em, all caps.
- **Tagline** — “EXPENSES MADE SIMPLE”. **Brand line** — “Track. Plan. Grow.”
- **Logo sizes** — 96 / 64 / 32 px, 24 px minimum.
- **Antler glyph** — 52 / 32 / 16 px.
- **Essence** — Simple, Private, Insightful, Growth-oriented.

## Which asset to use

| Situation | Use |
|---|---|
| Cream or paper surface | `vector/mark.svg` |
| Pine or dark surface | `vector/mark-cream.svg` |
| One-ink print, single-colour stamp | `vector/mark-mono.svg` (cream surfaces only) |
| Below 24 px, or a decorative repeat | `vector/glyph.svg` |
| App icon, favicon, avatar, social | `app-icons/bucksy-app-icon.svg` |
| Raster mark for docs/email | `assets/bucksy-mark-large.png` (900×1048) |

## Vector derivatives — what I changed and what I didn't

`vector/mark.svg`, `mark-cream.svg`, `mark-mono.svg` and `glyph.svg` are the
**same path data** as `app-icons/bucksy-app-icon.svg`, with the icon tile and its
clip mask removed and the viewBox cropped to the artwork. No curve was redrawn,
so the vectors match the delivered artwork exactly. The app-icon SVG remains the
master for icon-shaped use.

The wordmark is **typeset, not drawn**: “Bucksy” set in Inter 800 at −0.075em.
That is how the board does it. It means the wordmark must always be live text
(HTML/CSS) — never a flattened image — so it can use Inter properly:

```html
<span class="bucksy-wordmark">Bucksy</span>
<style>
  .bucksy-wordmark{
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    font-weight: 800; letter-spacing: -0.075em; line-height: .92;
  }
</style>
```

## Wired into the site

Icons live in `/assets` and are linked from both `index.html` and `app.html`:
`favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `icon-192.png`,
`icon-512.png`, `icon-1024.png`.

The in-app mark is `assets/mark.svg` (pine) and `assets/mark-cream.svg` (cream,
swapped by `body.dark-theme`). Both are **knockout builds**: the B and the deer
are one `fill-rule="evenodd"` path, so the deer is the real background rather
than a painted fill. That keeps the deer correct on cream *and* pine, instead of
approximating the surface colour.

**Applied:** `app.html` now runs on the brand palette — Pine/Fern/Sage/Cream/Stone
tokens for light and dark mode, Inter as the UI typeface, and the chart and
category colours re-hued to the palette (no blues left). Muted text and amber
text were darkened to hold AA contrast on cream (`#566F62`, `#9C5B08`).
The header and auth card now carry the Bucksy mark, wordmark and tagline, and the
app is titled Bucksy.

**Applied:** `index.html` is rebuilt on the same language — cream canvas, pine
type, Inter, the board's "Track. Plan. Grow." hero copy, the three pillars, the
hills band and the four essence words. Feature copy is limited to what the app
actually does; pricing, bank connections, CSV export and certifications are
deliberately absent.

## Rules

1. Amber on cream fails contrast (2.13:1) — decorative only. For amber-toned
   text use `#C97A0C` or darker.
2. Never place the mark on a busy photo; never outline it, gradient it, or rotate it.
3. At 24 px and below, switch to the antler glyph.
4. Keep the deer as negative space — don't fill it with a different colour than
   the surface it sits on.
5. The four essence words (Simple, Private, Insightful, Growth-oriented) are
   the filter for UI copy, not decoration.

## Known gaps

- No 1200×630 OG/social image yet (needs a raster export step).
- `brand/_archive/v1/` holds my earlier drafts, superseded by this board. Kept
  only for reference; safe to delete.
