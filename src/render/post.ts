import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// The finishing grade, applied AFTER tone mapping (sRGB domain, where
// saturation and vignette behave intuitively): a whisper of saturation so
// the palette zones pop, and a gentle corner vignette pulling the eye to
// the track. Cheap — pure math on pixels already shaded.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(luma), c.rgb, 1.07);
      float d = length((vUv - 0.5) * 2.0); // 0 center, ~1.41 corners
      c.rgb *= 1.0 - 0.28 * smoothstep(0.72, 1.5, d);
      gl_FragColor = c;
    }
  `,
};

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

  // The composer's default target has no MSAA, which would silently drop the
  // canvas's antialiasing the moment rendering moved off it — jaggies on
  // every low-poly edge. Hand it a multisampled half-float target instead
  // (cheap on tile-based mobile GPUs, where MSAA resolves in-tile).
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.5, // strength: a halo, not a fog
    0.4, // radius
    BLOOM_THRESHOLD
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(GradeShader)); // last: grades the tone-mapped image

  return {
    render: () => composer.render(),
    // CSS sizes, like renderer.setSize: the composer applies the renderer's
    // pixel ratio itself (custom target or not).
    setSize: (width: number, height: number) => composer.setSize(width, height),
  };
}
