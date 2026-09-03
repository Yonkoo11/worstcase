import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, interpolate } from "remotion";
import { COLORS, VIDEO_FILES } from "../constants";

/**
 * Mode B: the recording is silent and narration comes from a separate SceneAudio.
 * So the video is muted — adding its (nonexistent) audio would do nothing, but
 * leaving it unmuted is how the double-audio bug happens when a track is present.
 */
export const Recording: React.FC<{ file: keyof typeof VIDEO_FILES; duration: number }> = ({ file, duration }) => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 12, duration - 14, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <AbsoluteFill style={{ opacity: fade }}>
        <OffthreadVideo
          src={staticFile(VIDEO_FILES[file])}
          muted
          style={{ width: 1920, height: 1080, objectFit: "cover" }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
