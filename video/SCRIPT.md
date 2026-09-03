# Worstcase — demo narration

Archetype: **Security / Analytics**. Lineup follows the skill's Security spine,
trimmed to six scenes: Hook → Problem → Terminal → Recording → Evidence(OnChain) → Close.

PACING_MODE: `gap` (TTS, PLAYBACK_RATE 1.0, SCENE_GAP 45fr).
Voice: `en-US-AndrewMultilingualNeural` — the skill's documented Azure fallback for the
Security archetype. Gemini `gemini-speak` was not available in this environment.

Every figure, hash and terminal line below is real output from the shipped engine.

---

## hook

[SUB] Give an AI agent a wallet, and you have built a spending program
[SUB] that a language model steers at runtime.
[SUB] Before you fund it: how much can actually leave?

## problem

[SUB] The usual answer is a per-call limit.
[SUB] Per-call limits don't compose.
[SUB] Two payments that each pass a fifty dollar cap can still move sixty,
[SUB] if they race the same budget. A single-step guard can't see a multi-step path.

## terminal

[SUB] Worstcase compiles the agent's tools and spending policy into a state graph,
[SUB] then searches every reachable state for the most money that can leave.
[SUB] Twenty-seven fifty, on this manifest.
[SUB] A deterministic checker computed that. Not a model.

## interface

[SUB] The figure alone isn't useful, so it names the call that realises it,
[SUB] and the policy rule that let it through.
[SUB] Beside it sits the proof: everything the search ruled out.
[SUB] Tighten one policy edge and the same agent drops to zero,
[SUB] with the rule that blocked it named.

## evidence

[SUB] Every run is stored on 0G Storage and anchored on 0G Chain.
[SUB] Storage isn't trusted on its word: the bundle is downloaded back
[SUB] and its Merkle root re-derived before anything is recorded.
[SUB] The chain anchor binds the figure to the exact policy and engine that produced it.

## close

[SUB] 0G Compute stays out: five advisories with no fix at any version.
[SUB] Two surfaces are live, and the third says so rather than pretending.
[SUB] Worstcase. Know the worst-case spend before you fund the agent.
