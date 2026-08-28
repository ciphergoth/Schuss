import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// The HDR post pipeline: the scene renders linear into a half-float target,
// bloom skims off everything brighter than a screen white, and the OutputPass
// applies ACES filmic tone mapping + sRGB on the way to the canvas.
//
// Bloom is SELECTIVE by brightness, not by layer: materials that should glow
// (neon poles, star cones, fireworks, the airborne skier) carry HDR colors —
// plain sRGB colors multiplied past 1.0 via glowColor() — so they clear
// BLOOM_THRESHOLD while ordinary lit surfaces stay below it. Only the very
// hottest sunlit snow facets ever cross the line, and that reads as glare.
export const BLOOM_THRESHOLD = 1.25;
// One shared boost for glow materials. 3.2 clears the threshold even for
// low-luminance hues (bloom thresholds on luma, and pure magenta's is ~0.4).
export const GLOW_BOOST = 3.2;

export function glowColor(hex: number, boost = GLOW_BOOST): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(boost);
}

export interface Post {
  render: () => void;
  setSize: (width: number, height: number) => void;
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera
): Post {
  // Tone mapping is applied by the OutputPass (render-to-target skips the
  // renderer's own), but the pass reads its curve and exposure from here.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15; // ACES darkens mids; lift back to taste

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.5, // strength: a halo, not a fog
    0.4, // radius
    BLOOM_THRESHOLD
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return {
    render: () => composer.render(),
    setSize: (width: number, height: number) => composer.setSize(width, height),
  };
}
