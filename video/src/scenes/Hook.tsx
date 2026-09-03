import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { GlowText } from "../components/GlowText";
import { COLORS, SCENE_DURATIONS } from "../constants";
import { MONO } from "../fonts";

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [SCENE_DURATIONS.hook - 24, SCENE_DURATIONS.hook], [1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill>
      <AnimatedBackground />
      <AbsoluteFill style={{ justifyContent: "center", padding: "0 130px", opacity: exit }}>
        <GlowText text="PRE-FUNDING MODEL CHECKER" fontSize={20} color={COLORS.muted} delay={0}
          fontFamily={MONO} fontWeight={500} style={{ letterSpacing: 6, marginBottom: 34 }} />
        <GlowText text="How much can leave" fontSize={104} color={COLORS.white} delay={8}
          fontWeight={700} style={{ letterSpacing: -3, lineHeight: 1.02 }} />
        <GlowText text="before you fund it?" fontSize={104} color={COLORS.accent} delay={20}
          fontWeight={700} glowIntensity={1.4} style={{ letterSpacing: -3, lineHeight: 1.02 }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
