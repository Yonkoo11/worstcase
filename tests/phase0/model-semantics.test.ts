import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalHash, canonicalJson } from "../../packages/contracts/src/index.js";

describe("canonicalization contract", () => {
  it("sorts object keys recursively without reordering arrays", () => {
    const left = { z: 1, a: { y: 2, b: 3 }, path: ["b", "a"] };
    const right = { path: ["b", "a"], a: { b: 3, y: 2 }, z: 1 };
    expect(canonicalJson(left)).toBe('{"a":{"b":3,"y":2},"path":["b","a"],"z":1}');
    expect(canonicalHash(left)).toBe(canonicalHash(right));
  });

  it("rejects values that cannot be deterministic JSON contract data", () => {
    expect(() => canonicalJson({ amount: undefined })).toThrow(/undefined/);
    expect(() => canonicalJson({ amount: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/safe integers/);
    expect(() => canonicalJson({ amount: 1.5 })).toThrow(/safe integers/);
    expect(() => canonicalJson({ amount: 1n })).toThrow(/bigint/);
  });
});

describe("written model semantics", () => {
  it("states every release-critical result rule", () => {
    const semantics = readFileSync("docs/model-semantics.md", "utf8");
    for (const phrase of ["adversarial recipient", "bigint", "UNKNOWN", "UNSUPPORTED", "breadth-first", "fewest transitions", "Dominance pruning is forbidden"]) {
      expect(semantics).toContain(phrase);
    }
  });
});
