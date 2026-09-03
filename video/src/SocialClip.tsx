import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { Reveal } from "./components/Reveal";
import { AnimatedBackground } from "./components/AnimatedBackground";
import { GlowText } from "./components/GlowText";
import { COLORS, SOCIAL_DURATION } from "./constants";
import { MONO, SANS } from "./fonts";

// Orbs repositioned for the 1080x1920 viewport; the 16:9 presets sit off-canvas here.
const VERTICAL_ORBS = [
  { baseX: 880, baseY: 340, size: 460, color: COLORS.accent, blur: 130, opacity: 0.14, speed: 0.006 },
  { baseX: 180, baseY: 1500, size: 420, color: "#6e7d8c", blur: 120, opacity: 0.12, speed: 0.005 },
  { baseX: 540, baseY: 960, size: 520, color: COLORS.accentDim, blur: 140, opacity: 0.09, speed: 0.008 },
];

const Row: React.FC<{ label: string; value: string; tone: string; delay: number }> = ({ label, value, tone, delay }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame - delay, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
      padding: "22px 4px", borderBottom: `1px solid ${COLORS.border}`, opacity: o,
    }}>
      <span style={{ fontFamily: SANS, fontSize: 34, color: COLORS.offWhite }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 30, color: tone }}>{value}</span>
    </div>
  );
};

// No audio: social clips are watched muted, so the text carries it.
export const SocialClip: React.FC = () => {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [SOCIAL_DURATION - 20, SOCIAL_DURATION], [1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <AnimatedBackground orbs={VERTICAL_ORBS} />
      <AbsoluteFill style={{
        flexDirection: "column", justifyContent: "center", alignItems: "flex-start",
        padding: "0 74px", zIndex: 10, opacity: exit,
      }}>
        <GlowText text="MAXIMUM REACHABLE LOSS" fontSize={26} color={COLORS.muted} delay={2}
          fontFamily={MONO} fontWeight={500} style={{ letterSpacing: 5, marginBottom: 26 }} />

        <GlowText text="27.50" fontSize={188} color={COLORS.accent} delay={8} fontWeight={700}
          fontFamily={MONO} glowIntensity={1.6} style={{ letterSpacing: -8, lineHeight: 1 }} />
        <GlowText text="USDC can reach the attacker." fontSize={40} color={COLORS.white} delay={18}
          fontWeight={600} style={{ marginTop: 10, marginBottom: 56 }} />

        <Reveal delay={30} style={{ width: "100%" }}>
          <div style={{ width: "100%" }}>
            <Row label="Found by" value="state-space search" tone={COLORS.white} delay={30} />
            <Row label="After one policy fix" value="0.00" tone={COLORS.ok} delay={46} />
            <Row label="Anchored on" value="0G Chain · 16661" tone={COLORS.ok} delay={62} />
          </div>
        </Reveal>

        <Reveal delay={84} style={{ marginTop: 66, width: "100%" }}>
          <div>
            <div style={{ fontFamily: SANS, fontSize: 54, fontWeight: 700, color: COLORS.white, letterSpacing: -1.6 }}>
              Worstcase
            </div>
            <div style={{ fontFamily: SANS, fontSize: 30, color: COLORS.accent, marginTop: 10 }}>
              Know the worst-case spend before you fund the agent.
            </div>
          </div>
        </Reveal>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
