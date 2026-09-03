// AUTO-GENERATED from build/timings.json by gen-constants.py — GAP MODE.
// Audio is truth: every frame count below comes from ffprobe on the real narration.
export const FPS = 30;
export const W = 1920;
export const H = 1080;

// GAP mode: TTS narration at 1.0x with a silent tail before each crossfade.
// atempo=1.12 was applied at generation time, so NO playbackRate here — stacking
// the two would play the voice at 1.34x and sound clipped.
export const PACING_MODE = "gap" as const;
export const PLAYBACK_RATE = 1.0;
export const SCENE_GAP = Math.round(1.5 * FPS);
export const CROSSFADE = 15;

// The product's own design system, not an archetype default.
export const COLORS = {
  bg: "#0c0d0f", bgCard: "#131417", bgElevated: "#191b1f", bgOverlay: "#212429",
  accent: "#e0603a", accentDim: "#8f3a22", accentBright: "#ec6f48",
  accentGlow: "rgba(224, 96, 58, 0.15)",
  ok: "#7fa06b", amber: "#d9a441",
  white: "#e6e8ea", offWhite: "#9ba1a8", muted: "#666d75",
  border: "rgba(230, 232, 234, 0.09)", borderStrong: "rgba(230, 232, 234, 0.17)",
} as const;

export const TERMINAL = {
  bg: "#12100e", text: "#c9d9cd", green: "#7fa06b", yellow: "#d9a441",
  red: "#e0603a", blue: "#58a6ff", prompt: "#e0603a", dim: "#666d75",
} as const;

export const AUDIO_DURATIONS = {
  hook: 269,
  problem: 421,
  terminal: 474,
  interface: 501,
  evidence: 540,
  close: 406,
} as const;

export const SCENE_DURATIONS = {
  hook: AUDIO_DURATIONS.hook + SCENE_GAP,
  problem: AUDIO_DURATIONS.problem + SCENE_GAP,
  terminal: AUDIO_DURATIONS.terminal + SCENE_GAP,
  interface: AUDIO_DURATIONS.interface + SCENE_GAP,
  evidence: AUDIO_DURATIONS.evidence + SCENE_GAP,
  close: AUDIO_DURATIONS.close + SCENE_GAP,
} as const;

export const TOTAL_FRAMES = Object.values(SCENE_DURATIONS).reduce((a, b) => a + b, 0)
  - CROSSFADE * (Object.keys(SCENE_DURATIONS).length - 1);

export const AUDIO_FILES: Record<keyof typeof AUDIO_DURATIONS, string> = {
  hook: "audio/hook.mp3",
  problem: "audio/problem.mp3",
  terminal: "audio/terminal.mp3",
  interface: "audio/interface.mp3",
  evidence: "audio/evidence.mp3",
  close: "audio/close.mp3",
};

export const VIDEO_FILES = {
  interface: "video/interface.mp4",
  evidence: "video/evidence.mp4",
} as const;

// Must mirror the TransitionSeries order exactly; Subtitles walks this to build
// global offsets. Diverge and every subtitle after the divergence fires wrong.
export const SCENE_ORDER = ["hook", "problem", "terminal", "interface", "evidence", "close"] as const;

// Scene-local frames. Derived from the exact per-line clip durations, which are
// ground truth here because one clip was generated per subtitle line. Whisper's
// base model was run to check this and quantises to whole seconds, so it cannot
// improve on the derivation; drift stayed under its own resolution.
export const SUBTITLES = {
  hook: [
    { text: "Give an AI agent a wallet, and you have built a spending program", start: 0, end: 109 },
    { text: "that a language model steers at runtime.", start: 116, end: 181 },
    { text: "Before you fund it: how much can actually leave?", start: 188, end: 268 },
  ],
  problem: [
    { text: "The usual answer is a per-call limit.", start: 0, end: 67 },
    { text: "Per-call limits don't compose.", start: 74, end: 127 },
    { text: "Two payments that each pass a fifty dollar cap can still move sixty,", start: 133, end: 258 },
    { text: "if they race the same budget. A single-step guard can't see a multi-step path.", start: 265, end: 419 },
  ],
  terminal: [
    { text: "Worstcase compiles the agent's tools and spending policy into a state graph,", start: 0, end: 157 },
    { text: "then searches every reachable state for the most money that can leave.", start: 164, end: 280 },
    { text: "Twenty-seven fifty, on this manifest.", start: 287, end: 365 },
    { text: "A deterministic checker computed that. Not a model.", start: 372, end: 472 },
  ],
  interface: [
    { text: "The figure alone isn't useful, so it names the call that realises it,", start: 0, end: 126 },
    { text: "and the policy rule that let it through.", start: 133, end: 194 },
    { text: "Beside it sits the proof: everything the search ruled out.", start: 201, end: 301 },
    { text: "Tighten one policy edge and the same agent drops to zero,", start: 308, end: 436 },
    { text: "with the rule that blocked it named.", start: 443, end: 497 },
  ],
  evidence: [
    { text: "Every run is stored on 0G Storage and anchored on 0G Chain.", start: 0, end: 132 },
    { text: "Storage isn't trusted on its word: the bundle is downloaded back", start: 139, end: 262 },
    { text: "and its Merkle root re-derived before anything is recorded.", start: 268, end: 382 },
    { text: "The chain anchor binds the figure to the exact policy and engine that produced it.", start: 389, end: 538 },
  ],
  close: [
    { text: "0G Compute stays out: five advisories with no fix at any version.", start: 0, end: 156 },
    { text: "Two surfaces are live, and the third says so rather than pretending.", start: 163, end: 282 },
    { text: "Worstcase. Know the worst-case spend before you fund the agent.", start: 289, end: 405 },
  ],
} as const;

// Real values from the shipped engine and the live chain. Nothing invented.
export const TERMINAL_LINES = [
  { text: "~/worstcase $ npx vite-node scripts/anchor-run.ts prompt-injection", color: "prompt" },
  { text: "Fixture:        prompt-injection", color: "dim" },
  { text: "Result:         COMPLETE", color: "green" },
  { text: "Maximum loss:   27500000 base units", color: "red" },
  { text: "Bundle root:    0x304ff5d34bef92e9ddd4e5cbfe8bb83c8629f5aa1da20c4ea1b8ad3816cd27b0", color: "text" },
  { text: "Anchor request: contracts/deployments/anchor-request.json", color: "dim" },
] as const;

export const SOCIAL_FPS = 30;
export const SOCIAL_W = 1080;
export const SOCIAL_H = 1920;
export const SOCIAL_DURATION = 11 * SOCIAL_FPS;
