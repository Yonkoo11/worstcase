# Art Direction — Worstcase mark

## The lazy idea, named and forbidden

The obvious first solutions for this product, all rejected before drawing:

1. **A shield with a number in it.** Every security tool's mark. Also a lie: Worstcase does not
   protect anything, it measures. A shield promises defence the product does not provide.
2. **A padlock, a bug, a magnifying glass.** Category clichés. None encode *bounding*.
3. **A red downward arrow.** Generic finance-loss visual, and wrong: the loss here *climbs* to a
   ceiling, it does not fall.
4. **A "W" monogram in a rounded square.** This is literally what ships today, and it is the
   thing being replaced. A letter is not a metaphor.

All four are on the forbidden list below.

## Signature element

**A stepped ascent that stops dead at a hard rule.**

One continuous reading, left to right:
- a **staircase** climbing in the accent colour — value moving through reachable states, each
  riser a call the agent can make
- a **bound**: a single flat neutral rule the staircase touches and cannot cross
- a **terminal node**: a filled dot exactly where the last step meets the rule — the maximum
  reachable point, the counterexample's end
- **empty space above the rule**, which is the actual product. That void is the proven-unreachable
  region. It is the only part of the mark that means anything on its own.

This is a transformation, not a static icon: input (climbing) → process (bounded) → resolved
output (terminal node). It reads in one glance and it is ownable — a staircase-into-a-ceiling is
not a mark anyone else in this category is using.

## Material language

Flat and matte, matching a product built from 1px rules and two radii. No glass, no 3D, no
inner glows, no bevels. Depth comes only from a single faint accent wash behind the terminal
node, at the same opacity the interface already uses for its accent glow.

## Composition

- Square, centred, generous negative space, roughly 20% padding
- 14px-equivalent corner radius on the container — the same radius the interface uses for cells
- High-contrast silhouette: everything must survive being reduced to two tones
- The bound rule sits above centre so the void above it is visible, not cropped

## Palette

- ground `#0c0d0f`
- accent `#e0603a` — staircase and terminal node only
- bone `#e6e8ea` — the bound rule only
- No third colour. No gradient.

## Dual-legibility target

- **16px favicon:** the rule and a single ascending mass must still read. Fine risers will merge;
  that is acceptable as long as the ceiling-and-ascent silhouette survives.
- **32px gallery icon:** three risers, the rule, and the terminal node all distinguishable.
- **512px+:** the accent wash and the precision of the 1px rules reward a closer look.

## Forbidden list (gate, enforced while drawing and while judging)

shield · padlock · keyhole · bug · magnifying glass · robot head · brain · circuit traces ·
hexagons · blockchain cubes · chain links · sparkles · rainbow · purple-blue gradient ·
teal-coral gradient · any gradient mesh · gradient text · letterforms or monograms · watermark ·
trademarked glyphs · bubbly rounded blobs · drop shadows for decoration · more than one accent hue
