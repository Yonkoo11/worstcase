import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("threat-model contract", () => {
  it("defines all ten blocking invariants once", () => {
    const threatModel = readFileSync("docs/threat-model.md", "utf8");
    for (let index = 1; index <= 10; index += 1) {
      const id = `INV-${String(index).padStart(2, "0")}`;
      expect(threatModel.match(new RegExp(id, "g"))).toHaveLength(1);
    }
  });

  it("covers the six core trust failures", () => {
    const threatModel = readFileSync("docs/threat-model.md", "utf8").toLowerCase();
    for (const phrase of ["malicious manifest", "model/provider", "double-spend", "storage/indexer/rpc", "operator credentials", "unknown"]) {
      expect(threatModel).toContain(phrase);
    }
  });
});
