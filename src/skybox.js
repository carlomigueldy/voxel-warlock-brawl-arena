// Permanent vertical-gradient skybox (WS-J atmosphere pass). A single large
// back-side sphere sells a themed horizon behind the arena without a texture
// fetch — colors are driven entirely by uniforms so _applyHazardTheme() in
// renderer.js can retint it per hazard alongside the fog/glow. `fog: false`
// on the material keeps the gradient crisp regardless of scene.fog's
// near/far (the sphere sits well beyond the fog's far distance anyway).
import * as THREE from "three";

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform float offset;
  uniform float exponent;
  varying vec3 vWorldPosition;
  void main() {
    float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
    gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
  }
`;

// radius=180 clears the camera's far plane margin and the fog's far (90)
// with room to spare, so the gradient reads as an unreachable horizon.
const SKY_RADIUS = 180;

// `top`/`bottom` are hex numbers (e.g. 0x1a0b08); mirrors how ARENA_HAZARDS
// already carries `color`/`glow`/`fog` as hex ints (src/config.js).
export function createSkybox({ top = 0x1a0b1a, bottom = 0x0d0b1a } = {}) {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 15);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(top) },
      bottomColor: { value: new THREE.Color(bottom) },
      offset: { value: 20 },
      exponent: { value: 0.6 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1; // draw first, behind everything else in the scene
  mesh.matrixAutoUpdate = false; // sphere never moves/rotates; skip per-frame recompute
  mesh.updateMatrix();

  // Instant retint (no per-frame tween needed — hazard themes only change
  // between rounds, not mid-gameplay). Accepts the same hex-int colors as
  // ARENA_HAZARDS.sky.{top,bottom}.
  function setSkyTheme(nextTop, nextBottom) {
    if (nextTop != null) material.uniforms.topColor.value.setHex(nextTop);
    if (nextBottom != null) material.uniforms.bottomColor.value.setHex(nextBottom);
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
  }

  return { mesh, material, setSkyTheme, dispose };
}
