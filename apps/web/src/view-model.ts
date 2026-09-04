import type { DemoArtifact, DemoAction } from "../scripts/demo-artifacts.js";

/**
 * Neutralise text before it is concatenated into HTML.
 *
 * Lives here, not in main.ts, because main.ts renders the app at import time and so
 * cannot be imported by a test. Keeping this in a pure module lets the render-safety
 * suite assert what it actually does to hostile input instead of inspecting its source.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

export function formatMoney(baseUnits: string, decimals: number, minimumFractionDigits = 0): string {
  const negative = baseUnits.startsWith("-");
  const digits = negative ? baseUnits.slice(1) : baseUnits;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals || undefined);
  const rawFractional = decimals === 0 ? "" : padded.slice(-decimals);
  const trimmed = rawFractional.replace(/0+$/, "");
  const fractional = decimals === 0 ? "" : trimmed.padEnd(Math.min(minimumFractionDigits, decimals), "0");
  const value = fractional.length > 0 ? `${whole}.${fractional}` : whole;
  return `${negative ? "−" : ""}${value}`;
}

export function actionById(artifact: DemoArtifact, id: string): DemoAction | undefined {
  return artifact.actions.find((action) => action.id === id);
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function resultHeadline(artifact: DemoArtifact): string {
  if (artifact.result.status === "UNKNOWN") return "Loss bound unknown.";
  const amount = formatMoney(artifact.result.maximumLossBaseUnits ?? "0", artifact.asset.decimals, 2);
  return BigInt(artifact.result.maximumLossBaseUnits ?? "0") === 0n
    ? `No loss reaches the declared sink.`
    : `${amount} ${artifact.asset.symbol} can reach attacker.`;
}

export function fixtureLabel(fixtureId: string): string {
  return fixtureId.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
