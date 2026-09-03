import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { COLORS } from "../constants";

type Orb = { baseX: number; baseY: number; size: number; color: string; blur: number; opacity: number; speed: number };

// Matches the shipped interface's ground: warm accent top-right, cool mass bottom-left.
const DEFAULT_ORBS: Orb[] = [
  { baseX: 1620, baseY: 120, size: 620, color: COLORS.accent, blur: 130, opacity: 0.13, speed: 0.006 },
  { baseX: 220, baseY: 900, size: 520, color: "#6e7d8c", blur: 120, opacity: 0.12, speed: 0.005 },
  { baseX: 960, baseY: 520, size: 560, color: COLORS.accentDim, blur: 140, opacity: 0.09, speed: 0.008 },
];

export const AnimatedBackground: React.FC<{ orbs?: Orb[] }> = ({ orbs = DEFAULT_ORBS }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: COLORS.bg }}>
      {orbs.map((orb, i) => {
        const x = orb.baseX + Math.sin(frame * orb.speed + i * 1.5) * 90;
        const y = orb.baseY + Math.cos(frame * orb.speed + i * 2.1) * 70;
        return (
          <div key={i} style={{
            position: "absolute", left: x - orb.size / 2, top: y - orb.size / 2,
            width: orb.size, height: orb.size, borderRadius: "50%",
            background: orb.color, filter: `blur(${orb.blur}px)`, opacity: orb.opacity,
          }} />
        );
      })}
      <AbsoluteFill style={{
        opacity: 0.045, mixBlendMode: "overlay",
        backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/></filter><rect width='120' height='120' filter='url(%23n)' opacity='.6'/></svg>\")",
      }} />
    </AbsoluteFill>
  );
};
