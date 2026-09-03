import { loadFont as loadSans } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

// Loaded at module top level so headless rendering never captures a frame
// before the face is ready.
export const { fontFamily: SANS } = loadSans("normal", {
  weights: ["400", "500", "600", "700"], subsets: ["latin"],
});
export const { fontFamily: MONO } = loadMono("normal", {
  weights: ["400", "500", "700"], subsets: ["latin"],
});
