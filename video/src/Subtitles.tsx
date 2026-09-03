import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { SANS } from "./fonts";
import { SUBTITLES, SCENE_ORDER, SCENE_DURATIONS, CROSSFADE } from "./constants";

type Entry = { text: string; startFrame: number; endFrame: number };

// Global offsets are built once at module load by walking SCENE_ORDER and
// subtracting each crossfade. If SCENE_ORDER and the TransitionSeries order ever
// diverge, every subtitle after the divergence fires at the wrong frame.
function build(): Entry[] {
  const out: Entry[] = [];
  let offset = 0;
  SCENE_ORDER.forEach((key, i) => {
    const dur = SCENE_DURATIONS[key];
    const scene = SUBTITLES[key] as readonly { text: string; start: number; end: number }[] | undefined;
    if (scene !== undefined) {
      for (const s of scene) out.push({ text: s.text, startFrame: offset + s.start, endFrame: offset + s.end });
    }
    offset += dur - (i < SCENE_ORDER.length - 1 ? CROSSFADE : 0);
  });
  return out;
}
const ENTRIES = build();

export const Subtitles: React.FC = () => {
  const frame = useCurrentFrame();
  const active = ENTRIES.find((e) => frame >= e.startFrame && frame < e.endFrame);
  if (active === undefined) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", zIndex: 50 }}>
      <div style={{
        background: "rgba(0,0,0,0.74)", backdropFilter: "blur(8px)", borderRadius: 12,
        padding: "14px 30px", marginBottom: 56, maxWidth: 1600,
      }}>
        <div style={{ fontFamily: SANS, fontSize: 38, fontWeight: 600, color: "#ffffff", textAlign: "center", lineHeight: 1.36 }}>
          {active.text}
        </div>
      </div>
    </AbsoluteFill>
  );
};
