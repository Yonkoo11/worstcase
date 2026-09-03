import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { COLORS, TERMINAL } from "../constants";
import { MONO } from "../fonts";

type LineColor = keyof typeof TERMINAL;

/** Typewriter over REAL captured stdout. Nothing here is invented for the camera. */
export const Terminal: React.FC<{
  lines: readonly { readonly text: string; readonly color: string }[];
  title?: string; charsPerFrame?: number; delay?: number;
}> = ({ lines, title = "worstcase — engine", charsPerFrame = 3.4, delay = 10 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const prog = spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 150 } });
  const opacity = interpolate(prog, [0, 0.4], [0, 1], { extrapolateRight: "clamp" });
  const scale = interpolate(prog, [0, 1], [0.96, 1]);

  let budget = Math.max(0, (frame - delay - 6) * charsPerFrame);

  return (
    <div style={{
      opacity, transform: `scale(${scale})`, width: 1420, borderRadius: 14,
      background: TERMINAL.bg, border: `1px solid ${COLORS.borderStrong}`,
      boxShadow: `0 40px 90px -40px #000, 0 0 46px ${COLORS.accentGlow}`, overflow: "hidden",
    }}>
      <div style={{
        height: 52, display: "flex", alignItems: "center", gap: 9, padding: "0 22px",
        borderBottom: `1px solid ${COLORS.border}`, background: "#171412",
      }}>
        {["#e05c54", "#e0b34e", "#5cb85c"].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c }} />
        ))}
        <span style={{ marginLeft: 14, color: COLORS.muted, fontFamily: MONO, fontSize: 17 }}>{title}</span>
      </div>
      <div style={{ padding: "28px 30px", minHeight: 330, fontFamily: MONO, fontSize: 25, lineHeight: 1.62 }}>
        {lines.map((line, i) => {
          const shown = Math.max(0, Math.min(line.text.length, Math.floor(budget)));
          budget -= line.text.length;
          if (shown <= 0) return null;
          const color = (TERMINAL as Record<string, string>)[line.color] ?? TERMINAL.text;
          return (
            <div key={i} style={{ color, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {line.text.slice(0, shown)}
            </div>
          );
        })}
      </div>
    </div>
  );
};
