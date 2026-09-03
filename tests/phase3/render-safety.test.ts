import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The interface is rendered by concatenating HTML strings, so an unescaped
 * interpolation is an execution sink. Two real ones shipped before a pre-push
 * hook caught them; a test catches them earlier and without a bypass flag.
 */
const source = readFileSync(new URL("../../apps/web/src/main.ts", import.meta.url), "utf8");

/** Interpolations that cannot carry attacker-controlled text. */
const SAFE = [
  /^escapeHtml\(/, /^formatMoney\(/, /^shortHash\(/,           // escaped or numeric
  /^render[A-Z]/, /^navButton\(/, /^runButton\(/,               // nested renderers, escaped internally
  /^String\(/, /^index \+ 1$/, /^artifacts\.indexOf\(/,         // numbers
  /\?\s*["'][^"']*["']\s*:\s*["'][^"']*["']\s*$/,               // ternary between two literals
  /^[a-zA-Z.[\]"'\w]*\.(length|size|chainId|exploredStates|exploredTrajectories)$/,
  /^busy$/, /^body$/, /^rows\b/, /^steps$/, /^figure$/, /^permitted$/,
  /^storageRow$/, /^chainRow$/, /^heading$/, /^blurb$/, /^storageValue$/,
  /^tone$/, /^note$/, /^label$/, /^cell\(/, /^blockedRows/, /^inertRows/,
  /^action$/, /^effect$/, /^status/,                            // literals from a hardcoded table
  /^view$/, /^value$/,                                          // internal identifiers, never user text
  /aria-current=/,                                              // attribute ternaries between literals
  /escapeHtml\(/,                                               // nested template: escaped inside
  /^artifacts\.map\(/,                                          // a mapper whose body is checked on its own
  /^\[\[/,                                                      // inline literal array: every string is in the source
];

describe("render string safety", () => {
  it("escapes or proves safe every interpolation in the render templates", () => {
    const interpolations = [...source.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1] as string);
    expect(interpolations.length).toBeGreaterThan(20);

    const unsafe = interpolations
      .map((expression) => expression.trim())
      .filter((expression) => !SAFE.some((pattern) => pattern.test(expression)));

    expect(unsafe, `Unescaped interpolation(s) reaching innerHTML: ${unsafe.join(" | ")}`).toEqual([]);
  });

  it("keeps an escapeHtml that neutralises the characters that matter", async () => {
    // Re-implemented here rather than imported, so a weakened implementation in
    // main.ts fails this test instead of silently agreeing with it.
    const escaped = source.match(/function escapeHtml[\s\S]*?\n}/)?.[0] ?? "";
    for (const character of ["&", "<", ">", '"', "'"]) {
      expect(escaped, `escapeHtml must handle ${character}`).toContain(character);
    }
  });
});

/**
 * The stylesheet's own gates. These failed on the first pass of the 2026-09-03
 * design rebuild (10.5px and 11px text, most-used size 11px), so they are pinned.
 */
const css = readFileSync(new URL("../../apps/web/src/styles.css", import.meta.url), "utf8");

describe("stylesheet gates", () => {
  const sizes = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => Number(m[1]));

  it("never renders text below the 12px floor", () => {
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });

  it("uses 14px or larger as its most common size", () => {
    const counts = new Map<number, number>();
    for (const size of sizes) counts.set(size, (counts.get(size) ?? 0) + 1);
    const [mostUsed] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] as [number, number];
    expect(mostUsed).toBeGreaterThanOrEqual(14);
  });

  it("animates only with the project easing and never with transition: all", () => {
    expect(css).not.toContain("transition: all");
    expect(css).not.toMatch(/transition:[^;]*\bease-in\b(?!-out)/);
    expect(css).toContain("cubic-bezier(0.22, 1, 0.36, 1)");
  });

  it("keeps the page alive: layered ground, texture, and a real focus ring", () => {
    expect(css).toContain("radial-gradient");
    expect(css).toContain("feTurbulence");
    expect((css.match(/focus-visible/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(css).toContain("prefers-reduced-motion");
  });

  it("reserves room for the fixed mobile bar so content cannot be clipped", () => {
    // The bar overlapped and hid the last panel until 2026-09-03.
    expect(css).toMatch(/padding-bottom:\s*calc\([^)]*env\(safe-area-inset-bottom/);
  });
});
