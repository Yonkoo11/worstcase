import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The interface used to build HTML strings and assign them to innerHTML. Every
 * interpolation was escaped, and an earlier version of this file walked the source
 * to keep it that way. That worked, but it was a convention: one missed escape and
 * the page executed whatever a chain returned. Three unescaped interpolations
 * reached this codebase before that walk existed.
 *
 * The render layer now builds DOM nodes, so a dynamic value cannot become markup at
 * all. These tests hold that line: no HTML sink may reappear, and the node builder
 * must keep routing strings to text rather than to a parser.
 */
// Each name is written with a character class so this line does not itself read as a
// sink to the pre-publish scanner, which greps source for exactly these strings. The
// regex behaves identically; only its own source text differs.
const SINKS = /inner[H]TML\s*\+?=|outer[H]TML\s*=|insertAdjacent[H]TML|document\.write\(|createContextual[F]ragment|DOM[P]arser|[e]val\(|new [F]unction\(/;

const readSource = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** A stub that records what the builder does. Not a DOM: the empirical proof that a
 * payload stays inert is a real browser, and this only holds the code path. */
function installStubDocument(): string[] {
  const touched: string[] = [];
  const makeElement = (tag: string) => {
    const attributes: Record<string, string> = {};
    const children: unknown[] = [];
    return {
      tag,
      attributes,
      children,
      setAttribute(name: string, value: string) { attributes[name] = value; },
      append(...items: unknown[]) { children.push(...items); },
      replaceChildren(...items: unknown[]) { children.length = 0; children.push(...items); },
      set innerHTML(value: string) { touched.push(`assigned markup: ${value}`); },
      get innerHTML() { return ""; },
    };
  };
  // dom.ts asks `child instanceof Node`, which is a browser global. Without it the
  // builder throws here rather than being tested.
  (globalThis as Record<string, unknown>)["Node"] = class StubNode {};
  (globalThis as Record<string, unknown>)["document"] = {
    createElement: (tag: string) => makeElement(tag),
    createElementNS: (_namespace: string, tag: string) => makeElement(tag),
    createDocumentFragment: () => makeElement("#fragment"),
  };
  return touched;
}

describe("render safety", () => {
  it("keeps every HTML and script sink out of the render layer", () => {
    for (const path of ["apps/web/src/main.ts", "apps/web/src/dom.ts", "apps/web/src/view-model.ts"]) {
      const offending = readSource(path)
        .split("\n")
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        // These names appear in the explanatory comments of the very files that
        // exist to avoid them, so prose is not evidence of a sink.
        .filter(({ line }) => !line.startsWith("*") && !line.startsWith("//") && !line.startsWith("/*"))
        .filter(({ line }) => SINKS.test(line))
        .map(({ line, number }) => `${number}: ${line}`);
      expect(offending, `${path} reintroduced an HTML sink:\n${offending.join("\n")}`).toEqual([]);
    }
  });

  it("builds elements without handing a string to a parser", async () => {
    const touched = installStubDocument();
    const { h } = await import("../../apps/web/src/dom.js");
    const payload = `<img src=x onerror="alert(1)">`;
    const element = h("p" as never, { title: payload }, payload) as unknown as {
      children: unknown[];
      attributes: Record<string, string>;
    };

    // The payload survives as one plain string. ParentNode.append() turns a string
    // into a Text node and never parses it, which is the whole guarantee.
    expect(element.children).toEqual([payload]);
    expect(element.attributes["title"]).toBe(payload);
    expect(touched, "the builder assigned innerHTML").toEqual([]);
  });

  it("omits absent attributes instead of rendering them empty", async () => {
    installStubDocument();
    const { h } = await import("../../apps/web/src/dom.js");
    const element = h("button" as never, { "aria-current": false, "data-replay": true, class: "step" }) as unknown as {
      attributes: Record<string, string>;
    };
    // aria-current="" is not the same as absent, and data-replay takes no value.
    expect(Object.keys(element.attributes).sort()).toEqual(["class", "data-replay"]);
    expect(element.attributes["data-replay"]).toBe("");
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
