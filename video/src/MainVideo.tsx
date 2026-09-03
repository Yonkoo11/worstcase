import React from "react";
import { AbsoluteFill, Audio, staticFile, interpolate } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { COLORS, CROSSFADE, FPS, SCENE_DURATIONS, AUDIO_DURATIONS, AUDIO_FILES } from "./constants";
import { Hook } from "./scenes/Hook";
import { Problem } from "./scenes/Problem";
import { TerminalScene } from "./scenes/TerminalScene";
import { Recording } from "./scenes/Recording";
import { Close } from "./scenes/Close";
import { Subtitles } from "./Subtitles";

/**
 * GAP mode: the envelope fades out over the last second of the AUDIO, not the
 * scene, so narration is already silent before the crossfade begins.
 *
 * No playbackRate is set anywhere. atempo=1.12 was applied when the narration was
 * generated; stacking a Remotion rate on top would play the voice at 1.34x.
 */
const SceneAudio: React.FC<{ src: string; audioDuration: number }> = ({ src, audioDuration }) => (
  <Audio
    src={staticFile(src)}
    volume={(f) => {
      const inFade = interpolate(f, [0, Math.round(FPS * 0.3)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      const outFade = interpolate(f, [audioDuration - FPS, audioDuration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      return Math.min(inFade, outFade);
    }}
  />
);

// This order must mirror SCENE_ORDER in constants.ts exactly.
const scenes = [
  { id: "hook", node: <Hook /> },
  { id: "problem", node: <Problem /> },
  { id: "terminal", node: <TerminalScene /> },
  { id: "interface", node: <Recording file="interface" duration={SCENE_DURATIONS.interface} /> },
  { id: "evidence", node: <Recording file="evidence" duration={SCENE_DURATIONS.evidence} /> },
  { id: "close", node: <Close /> },
] as const;

export const MainVideo: React.FC = () => {
  const timing = linearTiming({ durationInFrames: CROSSFADE });
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <TransitionSeries>
        {scenes.flatMap((scene, i) => {
          const nodes = [
            <TransitionSeries.Sequence key={scene.id} durationInFrames={SCENE_DURATIONS[scene.id]}>
              {scene.node}
              <SceneAudio src={AUDIO_FILES[scene.id]} audioDuration={AUDIO_DURATIONS[scene.id]} />
            </TransitionSeries.Sequence>,
          ];
          if (i < scenes.length - 1) {
            nodes.push(<TransitionSeries.Transition key={`t-${scene.id}`} presentation={fade()} timing={timing} />);
          }
          return nodes;
        })}
      </TransitionSeries>
      <Subtitles />
    </AbsoluteFill>
  );
};
