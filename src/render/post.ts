import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// The HDR post pipeline: the scene renders linear into a half-float target,
// bloom skims off everything brighter than a screen white, and ONE combined
// output pass applies ACES filmic tone mapping, the sRGB transfer, and the
// finishing grade (saturation + vignette) on the way to the canvas. Tone
// mapping and grade used to be two separate full-screen passes; merging them
// saves a full framebuffer read/write per frame — real bandwidth on phones.
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

// Tone map + color space + grade in a single pass. The ACES fit below is
// three.js's own ACESFilmicToneMapping implementation (Stephen Hill's fit,
// including the 1/0.6 pre-exposure), inlined verbatim so the look is
// identical to the OutputPass it replaces.
const OutputGradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    exposure: { value: 1.15 }, // ACES darkens mids; lift back to taste
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
    uniform float exposure;
    varying vec2 vUv;
    vec3 RRTAndODTFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 acesFilmic(vec3 color) {
      const mat3 ACESInputMat = mat3(
        vec3(0.59719, 0.07600, 0.02840),
        vec3(0.35458, 0.90834, 0.13383),
        vec3(0.04823, 0.01566, 0.83777)
      );
      const mat3 ACESOutputMat = mat3(
        vec3(1.60475, -0.10208, -0.00327),
        vec3(-0.53108, 1.10813, -0.07276),
        vec3(-0.07367, -0.00605, 1.07602)
      );
      color *= exposure / 0.6;
      color = ACESInputMat * color;
      color = RRTAndODTFit(color);
      color = ACESOutputMat * color;
      return clamp(color, 0.0, 1.0);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb = acesFilmic(c.rgb);
      // Linear -> sRGB (what OutputPass's colorspace conversion did).
      c.rgb = mix(
        c.rgb * 12.92,
        1.055 * pow(c.rgb, vec3(1.0 / 2.4)) - 0.055,
        step(vec3(0.0031308), c.rgb)
      );
      // The grade, in sRGB where these controls behave intuitively: a
      // whisper of saturation so the palette zones pop, and a gentle corner
      // vignette pulling the eye to the track.
      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(luma), c.rgb, 1.07);
      float d = length((vUv - 0.5) * 2.0); // 0 center, ~1.41 corners
      c.rgb *= 1.0 - 0.28 * smoothstep(0.72, 1.5, d);
      gl_FragColor = c;
    }
  `,
};

export interface Post {
  render: () => void;
  setSize: (width: number, height: number) => void;
  // Adaptive resolution: re-scale every buffer in the chain. CSS size is
  // remembered from the last setSize, so callers just pass the new ratio.
  setPixelRatio: (ratio: number) => void;
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera
): Post {
  // Tone mapping lives in the combined output pass above, not the renderer
  // (render-to-target skips the renderer's own anyway).
  renderer.toneMapping = THREE.NoToneMapping;

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
  // Normalize the composer's size bookkeeping to CSS units (a custom target
  // seeds it with device pixels), so setSize/setPixelRatio stay consistent.
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.5, // strength: a halo, not a fog
    0.4, // radius
    BLOOM_THRESHOLD
  );
  composer.addPass(bloom);
  composer.addPass(new ShaderPass(OutputGradeShader)); // tone map + sRGB + grade, one pass

  return {
    render: () => composer.render(),
    // CSS sizes, like renderer.setSize: the composer applies the renderer's
    // pixel ratio itself (custom target or not).
    setSize: (width: number, height: number) => composer.setSize(width, height),
    setPixelRatio: (ratio: number) => {
      renderer.setPixelRatio(ratio);
      composer.setPixelRatio(ratio); // re-sizes every pass at the new scale
    },
  };
}
