# Worstcase — brand mark

## What the mark means

A **stepped ascent that stops dead at a hard rule.**

- The **orange staircase** is value climbing through reachable states. Each riser is one call
  the agent is able to make.
- The **bone rule** is the bound. Nothing crosses it — not a pixel, at any size. That is the
  product's single claim, so it is the mark's single constraint.
- The **empty space above the rule** is the part that was proven unreachable. It is the only
  region of the mark that means anything on its own.

The four steps are not decorative: the engine returns a *shortest* counterexample path, and the
mark shows a path arriving at a ceiling rather than a number sitting in a shield.

## Files

| File | What it is |
|---|---|
| `worstcase-mark.svg` | Primary mark. 64×64 viewBox, 6 nodes, no external refs. |
| `out/icon-{16..1024}.png` | Natively rendered at each size. **Nothing here is upscaled** — every PNG is a fresh render of the SVG at that pixel size. |
| `BRAND-TRUTH.md` | Stage 0: name, purpose, core verb, metaphor, palette, constraints. |
| `ART-DIRECTION.md` | Stage 1: signature element, material language, forbidden list. |
| `explore/` | Paper trail. Rounds A–C and D–F, plus the size sheets used to judge them. |
| `shots/` | Interface screenshots (gitignored — regenerate, don't commit). |

## Where it ships

- `apps/web/public/favicon.svg` — SVG favicon
- `apps/web/public/favicon-32.png` — PNG fallback
- `apps/web/public/apple-touch-icon.png` — 180×180
- `apps/web/public/icon-512.png` — `og:image` and the product-gallery icon slot
- Inline in `apps/web/src/main.ts` as the header mark

## Palette

Two colours and a ground. No third hue, no gradient except one accent bloom.

- ground `#0c0d0f`
- accent `#e0603a` — the climbing mass only
- bone `#e6e8ea` — the bound only

`#7fa06b` (the product's "zero loss / verified" green) is deliberately absent, so the mark never
implies a verdict about whatever it is sitting next to.

## What was rejected, and why

Rounds A–C put the terminal node *on* the rule. At every size the accent bled above the line,
which contradicts the one thing the mark exists to say. Rejected on concept, not on looks.

Round E was the most attractive render and was also rejected on concept: separated ascending bars
read as a bar chart, i.e. "analytics dashboard", not "bound".

Round F won because solid mass survives the 16px floor where a stroked path turns to mush, and
because accumulating value stopped by a rule is the actual metaphor.

## Verified, not assumed

The 16px favicon was rendered and its pixels inspected directly. The bound lands on exactly one
crisp pixel row and all four steps remain individually visible:

```
    ................
    ...BBBBBBBBBB...     B = bone (the bound)
    ..........oOO...     O = accent (reachable value)
    ........OOOOO...     o = antialiased accent
    .....oOOOOOOO...     . = ground
    ...OOOOOOOOOO...
    ................
```

The mark's horizontals sit on multiples of 4 in the 64 grid precisely so this row stays crisp at
a 0.25 scale factor. Moving them will soften the favicon.
