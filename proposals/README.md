# Design proposals

These are the design exploration, not the product. The shipped interface is `apps/web/`;
<https://yonkoo11.github.io/worstcase/> is what was actually built.

Three directions were drawn as standalone HTML with no shared genes, compared side by side,
and one was chosen. `index.html` is the catalogue.

| File | Direction | DNA |
|---|---|---|
| `proposal-1.html` | Verdict Sheet | `DNA-A-T-S-D-X` |
| `proposal-2.html` | The Statement | `DNA-S-H-F-M-E` |
| `proposal-3.html` | The Bench | `DNA-B-O-M-N-R` |

**Selected: proposal 3, The Bench**, plus one element lifted from proposal 1.

The problem being solved was hollowness. The engine had been corrected to return the *shortest*
path to the maximum loss, and that path is usually a single call, so a layout built for a three
to five row ledger left a large gap under its primary object. The Bench answers that with an
unequal bento: the path cell is deliberately small, so a one-step counterexample fills it instead
of rattling around in it, and "Ruled out" is a co-equal panel that carries the page when the path
is short or, for the clean and policy-fix runs, absent entirely. Everything a reader needs sits
above the fold.

Proposal 2 spelled the figure out in words and pushed the evidence below the fold. Good looking,
wrong audience: the figure is the most scannable object on the page and belongs in large tabular
mono. Proposal 1 was a close second, solving the same problem with a right rail, but its serif
sentence is slower to read than a raw number in a sixty second review. Its explicit
"WHY IT IS PERMITTED" label above the policy rule box was good enough to adopt into The Bench.

These files are frozen at the date they were drawn. They do not track later changes to the
shipped interface and are not wired to any data.
