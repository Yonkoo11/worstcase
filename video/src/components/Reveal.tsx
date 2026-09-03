import React from "react";
import { useCurrentFrame, interpolate } from "remotion";

/**
 * Delay in-flow content without <Sequence>.
 *
 * <Sequence> renders as an AbsoluteFill, so wrapping a flow child in one rips it
 * out of the column and pins it to the top-left corner. That produced stray
 * overlapping text in the first render of the Problem, Close and Social scenes.
 */
export const Reveal: React.FC<{ delay: number; children: React.ReactNode; style?: React.CSSProperties }> =
  ({ delay, children, style }) => {
    const frame = useCurrentFrame();
    const p = interpolate(frame - delay, [0, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return (
      <div style={{ opacity: p, transform: `translateY(${interpolate(p, [0, 1], [16, 0])}px)`, ...style }}>
        {children}
      </div>
    );
  };
