import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// ---------------------------------------------------------------------------
// Asset paths
// ---------------------------------------------------------------------------
const VAN_FBX_PATH = 'van/apocalyptic-old-van-driveable-with-interior/source/Van.fbx';
const CAN_FBX_PATH = 'bennyrizzo - 1950s-spam/source/Spam can.fbx';
const CAN_TEXTURE_PATH = 'bennyrizzo - 1950s-spam/textures/';

const ENV_MAP_URL =
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r164/examples/textures/equirectangular/venice_sunset_1k.hdr';

// ---------------------------------------------------------------------------
// Blender-frame transforms (Z-up, XYZ Euler in degrees)
// ---------------------------------------------------------------------------
const VAN_TARGET_DIMS = [2.67, 2.56, 5.93]; // meters, Blender X×Y×Z
const CAN_TARGET_DIMS = [2.47, 1.20, 1.96]; // meters, Blender X×Y×Z

const WIDE_BREAKPOINT = 800;
const NARROW_BREAKPOINT = 400;

const WIDE_LAYOUT = {
  van: { pos: [12.010000, -1.490000, 0.293134], rot: [90.0000, 0.0000, -20.4889], scale: 1.0000 },
  can: { pos: [-1.800000, -4.170000, 7.926760], rot: [95.1000, -1.2000, -16.4000], scale: 0.9300 },
};

const NARROW_LAYOUT = {
  van: { pos: [6.680000, 0.070000, 0.293134], rot: [90.0000, 0.0000, -20.4889], scale: 0.9600 },
  can: { pos: [-2.080000, -5.660000, 8.200000], rot: [95.1000, -1.2000, -16.4000], scale: 0.7900 },
};

const CAM_LOCATION = [-7.922897, -9.636917, 9.522479];
const CAM_ROTATION = [71.9608, 0.0004, -55.7089];
const CAM_LENS_MM = 37.8;
const CAM_SENSOR_HEIGHT_MM = 24;
const RENDER_ASPECT = 1920 / 1080;

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpVec3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function resolveLayout(width) {
  if (width >= WIDE_BREAKPOINT) {
    return {
      van: { pos: [...WIDE_LAYOUT.van.pos], rot: [...WIDE_LAYOUT.van.rot], scale: WIDE_LAYOUT.van.scale },
      can: { pos: [...WIDE_LAYOUT.can.pos], rot: [...WIDE_LAYOUT.can.rot], scale: WIDE_LAYOUT.can.scale },
    };
  }
  if (width >= NARROW_BREAKPOINT) {
    const t = (width - NARROW_BREAKPOINT) / (WIDE_BREAKPOINT - NARROW_BREAKPOINT);
    return {
      van: {
        pos: lerpVec3(NARROW_LAYOUT.van.pos, WIDE_LAYOUT.van.pos, t),
        rot: lerpVec3(NARROW_LAYOUT.van.rot, WIDE_LAYOUT.van.rot, t),
        scale: lerp(NARROW_LAYOUT.van.scale, WIDE_LAYOUT.van.scale, t),
      },
      can: {
        pos: lerpVec3(NARROW_LAYOUT.can.pos, WIDE_LAYOUT.can.pos, t),
        rot: lerpVec3(NARROW_LAYOUT.can.rot, WIDE_LAYOUT.can.rot, t),
        scale: lerp(NARROW_LAYOUT.can.scale, WIDE_LAYOUT.can.scale, t),
      },
    };
  }
  const k = width / NARROW_BREAKPOINT;
  return {
    van: { pos: [...NARROW_LAYOUT.van.pos], rot: [...NARROW_LAYOUT.van.rot], scale: NARROW_LAYOUT.van.scale * k },
    can: { pos: [...NARROW_LAYOUT.can.pos], rot: [...NARROW_LAYOUT.can.rot], scale: NARROW_LAYOUT.can.scale * k },
  };
}

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------
const BACKGROUND_COLOR = 0xffffff;
const TONE_MAPPING_EXPOSURE = 1.01;

const AMBIENT_INTENSITY = 0.83;
const KEY_LIGHT_COLOR = 0xfff5e6;
const KEY_LIGHT_INTENSITY = 3.01;
const KEY_LIGHT_POSITION = [5, 8, 7];
const FILL_LIGHT_COLOR = 0xf0f0ff;
const FILL_LIGHT_INTENSITY = 2.92;
const FILL_LIGHT_POSITION = [-4, 3, -5];
const RIM_LIGHT_INTENSITY = 2.92;
const RIM_LIGHT_POSITION = [0, -3, -6];
const HEMI_SKY = 0xffffff;
const HEMI_GROUND = 0xd0d0d0;
const HEMI_INTENSITY = 0.5;
const ENV_MAP_INTENSITY = 1.19;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const textureLoader = new THREE.TextureLoader();

function loadTex(basePath, filename, colorSpace) {
  const tex = textureLoader.load(basePath + filename);
  tex.colorSpace = colorSpace || THREE.LinearSRGBColorSpace;
  tex.flipY = true;
  return tex;
}

// Blender's "XYZ Euler" is extrinsic XYZ (= matrix Rz·Ry·Rx). Three.js's
// 'XYZ' Euler order is intrinsic (= Rx·Ry·Rz) — different matrix entirely.
// Three.js's 'ZYX' order produces Rz·Ry·Rx, which matches Blender's XYZ.
function setBlenderEulerXYZ(obj3d, [xDeg, yDeg, zDeg]) {
  obj3d.rotation.order = 'ZYX';
  obj3d.rotation.set(
    THREE.MathUtils.degToRad(xDeg),
    THREE.MathUtils.degToRad(yDeg),
    THREE.MathUtils.degToRad(zDeg),
  );
}

// Re-pivot a loaded model so its bbox center sits at its parent's local origin.
// This makes setBlenderEulerXYZ on the wrapper rotate the model around its
// visual center. Returns a Group that should be added to the scene; place
// position/rotation on that wrapper instead of on the model directly.
function centerPivot(model, scaleFactor) {
  // bbox in model's pre-scale local frame
  model.scale.set(1, 1, 1);
  model.position.set(0, 0, 0);
  model.quaternion.identity();
  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  model.traverse((c) => {
    if (c.isMesh && c.geometry) {
      c.geometry.computeBoundingBox();
      tmp.copy(c.geometry.boundingBox).applyMatrix4(c.matrixWorld);
      box.union(tmp);
    }
  });
  const localCenter = box.getCenter(new THREE.Vector3());

  model.scale.setScalar(scaleFactor);
  model.position.copy(localCenter.multiplyScalar(-scaleFactor));

  const pivot = new THREE.Group();
  pivot.add(model);
  return pivot;
}

// Native FBX bbox computed from Mesh leaves only (skipping skeletons / empties
// that can give Box3.setFromObject a degenerate or far-flung box).
function meshBoundsAtIdentity(root) {
  root.scale.set(1, 1, 1);
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  root.traverse((c) => {
    if (c.isMesh && c.geometry) {
      c.geometry.computeBoundingBox();
      tmp.copy(c.geometry.boundingBox).applyMatrix4(c.matrixWorld);
      box.union(tmp);
    }
  });
  return box.getSize(new THREE.Vector3());
}

// Uniform scale that brings the model's longest axis to the target's longest axis.
// Robust against unknown FBX units (cm vs m) and preserves proportions.
function uniformFitScale(nativeSize, targetDims) {
  const nativeMax = Math.max(nativeSize.x, nativeSize.y, nativeSize.z);
  const targetMax = Math.max(...targetDims);
  return nativeMax > 0 ? targetMax / nativeMax : 1;
}

// Van comes as one FBX with materials referenced by name only. Textures are
// intentionally not applied — parts get plain shaded materials, distinguished
// only by glass vs. opaque so windows still read as transparent.
function buildVanMaterial({ glass = false } = {}) {
  const opts = {
    color: 0xffffff,
    metalness: 0.2,
    roughness: 0.7,
    envMapIntensity: ENV_MAP_INTENSITY,
  };
  if (glass) {
    opts.transparent = true;
    opts.opacity = 0.35;
    opts.depthWrite = false;
    opts.metalness = 0.0;
    opts.roughness = 0.05;
  }
  return new THREE.MeshStandardMaterial(opts);
}

function buildVanMaterials() {
  const opaque = buildVanMaterial();
  const glass = buildVanMaterial({ glass: true });
  return {
    bamper: opaque,
    carsBottom: opaque,
    engine: opaque,
    body: opaque,
    inside: opaque,
    wheels: opaque,
    glass,
    glassB: glass,
  };
}

function pickVanMaterial(name, materials) {
  const n = (name || '').toLowerCase();
  if (n.includes('glassb')) return materials.glassB;
  if (n.includes('glass')) return materials.glass;
  if (n.includes('bamper') || n.includes('bumper')) return materials.bamper;
  if (n.includes('carsbottom') || n.includes('bottom')) return materials.carsBottom;
  if (n.includes('engine')) return materials.engine;
  if (n.includes('inside') || n.includes('interior')) return materials.inside;
  if (n.includes('wheel') || n.includes('tire')) return materials.wheels;
  if (n.includes('body') || n.includes('van')) return materials.body;
  return null;
}

function applyVanMaterials(root, materials) {
  const seen = new Set();
  root.traverse((child) => {
    if (!child.isMesh) return;
    const meshName = child.name || '';
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    const matName = mats.map((m) => m?.name || '').join('|');
    seen.add(`${meshName} :: ${matName}`);
    const picked =
      pickVanMaterial(matName, materials) ||
      pickVanMaterial(meshName, materials) ||
      materials.body;
    child.material = picked;
  });
  console.log('[van-can] van mesh/material slots:', [...seen]);
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
export function runVanCanScene() {
  // Hide DOM elements only used by other scenes.
  for (const id of ['controls-panel', 'landing-header', 'landing-page', 'landing-artwork-info']) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  // --- Renderer ---
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  // --- Scene ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);

  // --- Environment map ---
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  new RGBELoader().load(ENV_MAP_URL, (hdrEquirect) => {
    const envMap = pmremGenerator.fromEquirectangular(hdrEquirect).texture;
    scene.environment = envMap;
    hdrEquirect.dispose();
    pmremGenerator.dispose();
  });

  // Blender uses Z-up; Three.js uses Y-up. Rotate -90° about world X so the
  // Blender XYZ values for position/rotation can be plugged in unchanged.
  const blenderRoot = new THREE.Group();
  blenderRoot.rotation.x = -Math.PI / 2;
  scene.add(blenderRoot);

  // --- Camera (vertical FOV from 37.8mm lens on 24mm sensor height) ---
  const vfovDeg = THREE.MathUtils.radToDeg(
    2 * Math.atan((CAM_SENSOR_HEIGHT_MM / 2) / CAM_LENS_MM),
  );
  const camera = new THREE.PerspectiveCamera(
    vfovDeg,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  blenderRoot.add(camera);

  // --- Live tweak state (seeded from responsive layout for current width) ---
  let canPivot = null;
  let vanPivot = null;
  const initialLayout = resolveLayout(window.innerWidth);
  const canState = {
    pos: [...initialLayout.can.pos],
    rot: [...initialLayout.can.rot],
    scale: initialLayout.can.scale,
  };
  const vanState = {
    pos: [...initialLayout.van.pos],
    rot: [...initialLayout.van.rot],
    scale: initialLayout.van.scale,
  };
  const camState = { pos: [...CAM_LOCATION], rot: [...CAM_ROTATION] };

  function syncResponsiveLayout() {
    const layout = resolveLayout(window.innerWidth);
    canState.pos.splice(0, 3, ...layout.can.pos);
    canState.rot.splice(0, 3, ...layout.can.rot);
    canState.scale = layout.can.scale;
    vanState.pos.splice(0, 3, ...layout.van.pos);
    vanState.rot.splice(0, 3, ...layout.van.rot);
    vanState.scale = layout.van.scale;
  }

  function applyTransforms() {
    if (canPivot) {
      canPivot.position.set(...canState.pos);
      setBlenderEulerXYZ(canPivot, canState.rot);
      canPivot.scale.setScalar(canState.scale);
    }
    if (vanPivot) {
      vanPivot.position.set(...vanState.pos);
      setBlenderEulerXYZ(vanPivot, vanState.rot);
      vanPivot.scale.setScalar(vanState.scale);
    }
    camera.position.set(...camState.pos);
    setBlenderEulerXYZ(camera, camState.rot);
  }
  applyTransforms();

  // --- Lighting ---
  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));

  const hemiLight = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY);
  hemiLight.position.set(0, 10, 0);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(KEY_LIGHT_COLOR, KEY_LIGHT_INTENSITY);
  keyLight.position.set(...KEY_LIGHT_POSITION);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(FILL_LIGHT_COLOR, FILL_LIGHT_INTENSITY);
  fillLight.position.set(...FILL_LIGHT_POSITION);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, RIM_LIGHT_INTENSITY);
  rimLight.position.set(...RIM_LIGHT_POSITION);
  scene.add(rimLight);

  // Origin axes so we can confirm where the Blender frame's origin is in the viewport.
  blenderRoot.add(new THREE.AxesHelper(2));

  // --- Van ---
  const vanMaterials = buildVanMaterials();

  new FBXLoader().load(
    VAN_FBX_PATH,
    (van) => {
      applyVanMaterials(van, vanMaterials);

      const nativeSize = meshBoundsAtIdentity(van);
      const scaleFactor = uniformFitScale(nativeSize, VAN_TARGET_DIMS);
      vanPivot = centerPivot(van, scaleFactor);
      blenderRoot.add(vanPivot);
      applyTransforms();

      console.log('[van-can] van FBX loaded', {
        nativeSize: [nativeSize.x, nativeSize.y, nativeSize.z],
        scaleFactor,
        finalSize: [nativeSize.x * scaleFactor, nativeSize.y * scaleFactor, nativeSize.z * scaleFactor],
      });
      window.__van = van;
      window.__vanPivot = vanPivot;
    },
    (xhr) => {
      if (xhr.lengthComputable) {
        console.log(`[van-can] van FBX ${(xhr.loaded / xhr.total * 100).toFixed(0)}%`);
      }
    },
    (err) => console.error('[van-can] van FBX failed to load:', err),
  );

  // --- Can (PBR material mirroring lib/can.js, no decal/baking) ---
  const canMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: loadTex(CAN_TEXTURE_PATH, 'BaseColor.png', THREE.SRGBColorSpace),
    metalnessMap: loadTex(CAN_TEXTURE_PATH, 'Metallic_4.png'),
    metalness: 1.0,
    roughnessMap: loadTex(CAN_TEXTURE_PATH, 'Roughness.png'),
    roughness: 1.0,
    normalMap: loadTex(CAN_TEXTURE_PATH, 'Normal.png'),
    envMapIntensity: ENV_MAP_INTENSITY,
  });

  new FBXLoader().load(
    CAN_FBX_PATH,
    (can) => {
      can.traverse((child) => {
        if (child.isMesh) child.material = canMaterial;
      });

      const nativeSize = meshBoundsAtIdentity(can);
      const scaleFactor = uniformFitScale(nativeSize, CAN_TARGET_DIMS);
      canPivot = centerPivot(can, scaleFactor);
      blenderRoot.add(canPivot);
      applyTransforms();

      console.log('[van-can] can FBX loaded', {
        nativeSize: [nativeSize.x, nativeSize.y, nativeSize.z],
        scaleFactor,
        finalSize: [nativeSize.x * scaleFactor, nativeSize.y * scaleFactor, nativeSize.z * scaleFactor],
      });
      window.__can = can;
      window.__canPivot = canPivot;

      const loadingEl = document.getElementById('loading');
      if (loadingEl) loadingEl.classList.add('hidden');
    },
    undefined,
    (err) => {
      console.error('[van-can] can FBX failed to load:', err);
      const loadingEl = document.getElementById('loading');
      if (loadingEl) loadingEl.textContent = 'Failed to load model.';
    },
  );

  // --- Render loop ---
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();

  // --- Resize: live aspect (no stretching) + responsive van/can layout ---
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    syncResponsiveLayout();
    applyTransforms();
  });

  buildTweakPanel({ canState, vanState, camState, applyTransforms });
}

// ---------------------------------------------------------------------------
// Tweak panel — manual sliders for can/van/camera transforms.
// Inject DOM + styles directly so the rest of the codebase stays untouched.
// ---------------------------------------------------------------------------
const TWEAK_PANEL_STYLES = `
  .van-can-panel {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 100;
    background: rgba(255,255,255,0.96);
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 0.6rem 0.75rem;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 0.8rem;
    color: #222;
    width: 320px;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    box-shadow: 0 2px 12px rgba(0,0,0,0.12);
  }
  .van-can-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
    margin-bottom: 0.4rem;
  }
  .van-can-panel-header button {
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    cursor: pointer;
  }
  .van-can-panel.collapsed .van-can-panel-body { display: none; }
  .van-can-panel section { margin-bottom: 0.6rem; }
  .van-can-panel section h3 {
    font-size: 0.8rem;
    font-weight: 600;
    margin: 0.3rem 0 0.2rem;
    color: #333;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .van-can-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.15rem 0;
  }
  .van-can-row > label {
    width: 3.2rem;
    font-size: 0.72rem;
    color: #555;
  }
  .van-can-row input[type="range"] { flex: 1; min-width: 0; }
  .van-can-row input[type="number"] {
    width: 4.6rem;
    padding: 0.1rem 0.25rem;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }
  .van-can-copy {
    width: 100%;
    padding: 0.4rem;
    margin-top: 0.4rem;
    cursor: pointer;
    font-size: 0.78rem;
    background: #111;
    color: #fff;
    border: none;
    border-radius: 4px;
  }
  .van-can-copy:hover { background: #333; }
`;

function buildTweakPanel({ canState, vanState, camState, applyTransforms }) {
  if (!document.getElementById('van-can-panel-styles')) {
    const style = document.createElement('style');
    style.id = 'van-can-panel-styles';
    style.textContent = TWEAK_PANEL_STYLES;
    document.head.appendChild(style);
  }

  const panel = document.createElement('div');
  panel.className = 'van-can-panel';
  panel.innerHTML = `
    <div class="van-can-panel-header">
      <span>Tweak transforms</span>
      <button type="button" class="van-can-toggle">Hide</button>
    </div>
    <div class="van-can-panel-body"></div>
  `;
  document.body.appendChild(panel);

  const body = panel.querySelector('.van-can-panel-body');
  const toggleBtn = panel.querySelector('.van-can-toggle');
  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    toggleBtn.textContent = panel.classList.contains('collapsed') ? 'Show' : 'Hide';
  });

  function addSection(title, state, opts = {}) {
    const section = document.createElement('section');
    section.innerHTML = `<h3>${title}</h3>`;
    body.appendChild(section);

    const axes = ['X', 'Y', 'Z'];
    addVectorRows(section, 'Pos', state.pos, -20, 20, 0.01, applyTransforms);
    addVectorRows(section, 'Rot', state.rot, -180, 180, 0.1, applyTransforms);
    if (opts.scale) {
      addScalarRow(section, 'Scale', state, 'scale', 0.1, 5, 0.01, applyTransforms);
    }
  }

  function addVectorRows(parent, label, vec, min, max, step, onChange) {
    const axes = ['X', 'Y', 'Z'];
    axes.forEach((axis, i) => {
      const row = document.createElement('div');
      row.className = 'van-can-row';
      row.innerHTML = `
        <label>${label} ${axis}</label>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${vec[i]}">
        <input type="number" step="${step}" value="${vec[i]}">
      `;
      parent.appendChild(row);
      const range = row.querySelector('input[type="range"]');
      const num = row.querySelector('input[type="number"]');
      const handler = (src) => () => {
        const v = parseFloat(src.value);
        if (!Number.isFinite(v)) return;
        vec[i] = v;
        if (src === range) num.value = v;
        else range.value = v;
        onChange();
      };
      range.addEventListener('input', handler(range));
      num.addEventListener('input', handler(num));
    });
  }

  function addScalarRow(parent, label, obj, key, min, max, step, onChange) {
    const row = document.createElement('div');
    row.className = 'van-can-row';
    row.innerHTML = `
      <label>${label}</label>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${obj[key]}">
      <input type="number" step="${step}" value="${obj[key]}">
    `;
    parent.appendChild(row);
    const range = row.querySelector('input[type="range"]');
    const num = row.querySelector('input[type="number"]');
    const handler = (src) => () => {
      const v = parseFloat(src.value);
      if (!Number.isFinite(v)) return;
      obj[key] = v;
      if (src === range) num.value = v;
      else range.value = v;
      onChange();
    };
    range.addEventListener('input', handler(range));
    num.addEventListener('input', handler(num));
  }

  addSection('Can', canState, { scale: true });
  addSection('Van', vanState, { scale: true });
  addSection('Camera', camState, { scale: false });

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'van-can-copy';
  copyBtn.textContent = 'Copy values';
  body.appendChild(copyBtn);

  const fmtVec = (v, p = 6) => `[${v.map((n) => n.toFixed(p)).join(', ')}]`;
  copyBtn.addEventListener('click', () => {
    const text =
      `const VAN_LOCATION = ${fmtVec(vanState.pos, 6)};\n` +
      `const VAN_ROTATION = ${fmtVec(vanState.rot, 4)};\n` +
      `const VAN_SCALE = ${vanState.scale.toFixed(4)};\n` +
      `const CAN_LOCATION = ${fmtVec(canState.pos, 6)};\n` +
      `const CAN_ROTATION = ${fmtVec(canState.rot, 4)};\n` +
      `const CAN_SCALE = ${canState.scale.toFixed(4)};\n` +
      `const CAM_LOCATION = ${fmtVec(camState.pos, 6)};\n` +
      `const CAM_ROTATION = ${fmtVec(camState.rot, 4)};`;
    console.log(text);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => { copyBtn.textContent = 'Copied!'; setTimeout(() => (copyBtn.textContent = 'Copy values'), 1200); },
        () => { copyBtn.textContent = 'Copy failed (see console)'; },
      );
    }
  });
}
