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
const VAN_LOCATION = [12.984661, -2.486563, 0.293134];
const VAN_ROTATION = [90.0, 0.0, -20.4889];
const VAN_TARGET_DIMS = [2.67, 2.56, 5.93]; // meters, Blender X×Y×Z

const CAN_LOCATION = [-0.805306, -5.155402, 7.926760];
const CAN_ROTATION = [75.6502, 5.0655, -12.0060];
const CAN_TARGET_DIMS = [2.47, 1.20, 1.96]; // meters, Blender X×Y×Z

const CAM_LOCATION = [-7.922897, -9.636917, 9.522479];
const CAM_ROTATION = [71.9608, 0.0004, -55.7089];
const CAM_LENS_MM = 37.8;
const CAM_SENSOR_HEIGHT_MM = 24;
const RENDER_ASPECT = 1920 / 1080;

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
  const camera = new THREE.PerspectiveCamera(vfovDeg, RENDER_ASPECT, 0.1, 1000);
  camera.position.set(...CAM_LOCATION);
  setBlenderEulerXYZ(camera, CAM_ROTATION);
  blenderRoot.add(camera);

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
      const vanPivot = centerPivot(van, scaleFactor);
      vanPivot.position.set(...VAN_LOCATION);
      setBlenderEulerXYZ(vanPivot, VAN_ROTATION);
      blenderRoot.add(vanPivot);

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
      const canPivot = centerPivot(can, scaleFactor);
      canPivot.position.set(...CAN_LOCATION);
      setBlenderEulerXYZ(canPivot, CAN_ROTATION);
      blenderRoot.add(canPivot);

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

  // --- Render loop (static framing — no controls, fixed aspect) ---
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();

  // --- Resize: keep renderer matching window, but lock camera aspect to 16:9 ---
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
