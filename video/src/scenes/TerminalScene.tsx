import React from "react";
import { AbsoluteFill } from "remotion";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { Terminal } from "../components/Terminal";
import { TERMINAL_LINES } from "../constants";

export const TerminalScene: React.FC = () => (
  <AbsoluteFill>
    <AnimatedBackground />
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <Terminal lines={TERMINAL_LINES} />
    </AbsoluteFill>
  </AbsoluteFill>
);
