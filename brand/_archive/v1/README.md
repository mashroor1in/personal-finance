# Bucksy Brand Assets — v0.2

Hand-built SVG identity assets. Nothing here is wired into the app yet; this
folder is the source kit for the rebrand described in the brand book.

## Files

| File | Use |
|---|---|
| `mark.svg` | The Buck — deer head, colour (pine + amber). Primary mark. v0.2: soft-shield head, three-tine antlers. |
| `glyph.svg` | Antlers only. Favicons and anything below 32px. |
| `wordmark.svg` | Hand-tuned monoline lowercase `bucksy`. |
| `logo-horizontal.svg` | Mark + wordmark. Site header, docs, email. |
| `logo-stacked.svg` | Mark above wordmark. Splash, OG images, merch. |
| `mark-mono-pine.svg` | One-colour mark for cream/paper surfaces. |
| `mark-mono-cream.svg` | One-colour mark for pine/dark surfaces. |
| `mark-badge-light.svg` | Cream roundel + deer. App icon / avatar. |
| `mark-badge-dark.svg` | Pine roundel + cream deer. App icon on dark. |
| `board.html` | Brand board: palette, type, sizes, rules. Open in a browser. |

## Concepts (open `concepts/sheet.html`)

Four alternative logo ideas, pending the user's pick. Nothing here is final.

| File | Idea |
|---|---|
| `concepts/c1-monogram.svg` | The lowercase `b` of bucksy, its ascender growing an antler. Name-first. |
| `concepts/c2-silhouette.svg` | Faceless buck silhouette. Animal-first, editorial, no cartoon expression. |
| `concepts/c3-roundel.svg` | Pine disc with the buck cut out of it. Privacy-first, app-icon native. |
| `concepts/c4-antler-chart.svg` | One amber antler that is also a rising chart. Meaning-first, most scalable. |
| `concepts/sheet.html` | Side-by-side comparison at 96/48/32/16px, on dark, with the wordmark. |

## Tokens

| Token | Hex | Role |
|---|---|---|
| Pine 900 | `#10332B` | Dark surfaces, dark mode base |
| Pine 700 | `#1C4A3C` | Primary actions, the deer |
| Sage 500 | `#7FA98E` | Secondary UI, charts |
| Sage 200 | `#D8E5D3` | Tints, dividers, hover |
| Cream 100 | `#F7F3EA` | Page canvas |
| Paper | `#FBF8F1` | Cards on cream |
| Ink | `#20241F` | Body text on cream |
| Amber 500 | `#E8A33D` | Accent, antlers, attention |
| Amber 700 | `#C9821F` | Amber-toned text on cream |
| Clay 500 | `#C25450` | Errors, over-budget |

## Type

- Display: **Fraunces** (variable, opsz axis) — headings and brand moments.
- UI/body: **Plus Jakarta Sans** — already used by the app.
- Money: **JetBrains Mono**, tabular figures — already used by the app.

## Hard rules

1. Amber on cream is decorative only (fails text contrast); use Amber 700 for text.
2. No currency symbols in the antlers or eyes; no gradients on the deer.
3. One deer moment per screen; the character never stands next to money figures.
4. Below 32px, use the antler glyph, not the full head.
5. The Dots (three amber dots) are the privacy motif — never used inside the ledger area.

## Status / next steps

- v0.2, uncommitted. Rework of v0.1: fixed the wordmark "b" reading as "d"
  (bowl arc sweep flag), redrew the mark (96×96 canvas, soft-shield head,
  three-tine antlers). All files carry the same v0.2 geometry.
- Awaiting the user's externally generated logo candidate; once shared, it will
  be assessed and integrated as the primary asset set.
- PNG exports (favicon.ico, 192/512 PWA icons) still need to be generated from
  `mark-badge-*.svg` — SVG favicons work in modern browsers but not everywhere.
- Wiring into `index.html` / `app.html` (tokens, header mark, auth screen,
  recovery modal) is the next rollout step and is **not** done here.
