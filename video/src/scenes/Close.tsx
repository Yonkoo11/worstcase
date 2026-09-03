import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { Reveal } from "../components/Reveal";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { GlowText } from "../components/GlowText";
import { COLORS, SCENE_DURATIONS } from "../constants";
import { MONO, SANS } from "../fonts";

const Fact: React.FC<{ k: string; v: string; tone?: string }> = ({ k, v, tone }) => (
  <div style={{ padding: "22px 30px", borderRight: `1px solid ${COLORS.border}` }}>
    <div style={{ fontFamily: MONO, fontSize: 17, letterSpacing: 3, color: COLORS.muted, textTransform: "uppercase" }}>{k}</div>
    <div style={{ fontFamily: MONO, fontSize: 26, color: tone ?? COLORS.white, marginTop: 10 }}>{v}</div>
  </div>
);

export const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [SCENE_DURATIONS.close - 26, SCENE_DURATIONS.close], [1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill>
      <AnimatedBackground />
      <AbsoluteFill style={{ justifyContent: "center", padding: "0 130px", opacity: exit }}>
        <GlowText text="Worstcase" fontSize={98} color={COLORS.white} delay={4} fontWeight={700}
          style={{ letterSpacing: -3 }} />
        <GlowText text="Know the worst-case spend before you fund the agent."
          fontSize={34} color={COLORS.accent} delay={16} fontWeight={500} glowIntensity={0.9}
          style={{ marginTop: 18 }} />
        <Reveal delay={38} style={{ marginTop: 52 }}>
          <div style={{
            display: "flex", borderRadius: 14, overflow: "hidden",
            border: `1px solid ${COLORS.border}`, background: COLORS.bgCard, width: "fit-content",
          }}>
            <Fact k="0G Chain" v="anchored · 16602" tone={COLORS.ok} />
            <Fact k="0G Storage" v="re-verified" tone={COLORS.ok} />
            <Fact k="0G Compute" v="not live — stated" tone={COLORS.amber} />
          </div>
        </Reveal>
        <Reveal delay={58} style={{ marginTop: 42 }}>
          <div style={{ fontFamily: SANS, fontSize: 27, color: COLORS.offWhite }}>
            yonkoo11.github.io/worstcase &nbsp;·&nbsp; github.com/Yonkoo11/worstcase
          </div>
        </Reveal>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
