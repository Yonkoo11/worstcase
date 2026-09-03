import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Reveal } from "../components/Reveal";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { GlowText } from "../components/GlowText";
import { COLORS } from "../constants";
import { MONO, SANS } from "../fonts";

const Card: React.FC<{ delay: number; label: string; value: string; note: string; tone: string }> =
  ({ delay, label, value, note, tone }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const p = spring({ frame: frame - delay, fps, config: { damping: 16, stiffness: 140 } });
    return (
      <div style={{
        flex: 1, padding: 44, borderRadius: 16, background: `linear-gradient(180deg, ${COLORS.bgElevated}, ${COLORS.bgCard})`,
        border: `1px solid ${COLORS.border}`, opacity: interpolate(p, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }),
        transform: `translateY(${interpolate(p, [0, 1], [22, 0])}px) scale(${interpolate(p, [0, 1], [0.95, 1])})`,
      }}>
        <div style={{ fontFamily: MONO, fontSize: 18, letterSpacing: 3, color: COLORS.muted, textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontFamily: MONO, fontSize: 76, fontWeight: 700, color: tone, marginTop: 18, letterSpacing: -2 }}>{value}</div>
        <div style={{ fontFamily: SANS, fontSize: 24, color: COLORS.offWhite, marginTop: 14 }}>{note}</div>
      </div>
    );
  };

export const Problem: React.FC = () => (
  <AbsoluteFill>
    <AnimatedBackground />
    <AbsoluteFill style={{ justifyContent: "center", padding: "0 120px" }}>
      <GlowText text="Per-call limits don't compose." fontSize={62} color={COLORS.white} delay={4}
        fontWeight={700} style={{ letterSpacing: -1.6, marginBottom: 56 }} />
      <div style={{ display: "flex", gap: 28 }}>
        <Card delay={22} label="Per-call cap" value="50.00" note="Each payment passes on its own." tone={COLORS.ok} />
        <Card delay={40} label="Actually moved" value="60.00" note="Two calls racing the same budget." tone={COLORS.accent} />
      </div>
      <Reveal delay={64} style={{ marginTop: 46 }}>
        <div style={{ fontFamily: SANS, fontSize: 27, color: COLORS.offWhite }}>
          A single-step guard cannot see a multi-step path.
        </div>
      </Reveal>
    </AbsoluteFill>
  </AbsoluteFill>
);
