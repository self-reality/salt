// -----------------------------------------------------------------------------
// label-can.js — label.html's builder + a live 3D can floating over the band.
//
// Reuses label.js's entire control wiring (artwork picker, colours, variables,
// band-height drag) via its exported main(), and overlays a transparent Three.js
// can — borrowing scenes/queue-1.js's lighting / env map / camera / orbit setup —
// that mirrors the same shared label build. Editing any control repaints both the
// flat band (page background) and the wrapped can (foreground) together.
//
// The "Can placement" panel moves/scales the can over the label; tweak it in the
// page, then paste the readout's CAN_POSITION / CAN_SCALE values into the
// constants below to bake them as defaults.
// -----------------------------------------------------------------------------

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadCan } from './lib/can.js';
import { REF_HEIGHT } from './lib/label-texture.js';
import { main } from './label.js';

// --- Can placement defaults --------------------------------------------------
// Pasted from the "Can placement" panel's readout. The can sits on a pivot
// recentred on its own bounding box, and the offset is applied in VIEW space:
// X = screen right, Y = screen up, Z = toward the camera (the only axis that
// changes apparent size). Scale is uniform about the can's centre. The camera
// frames the origin, so [0,0,0] / 1 = centred and filling the band.
const CAN_POSITION = [0, 0, 0]; // screen-right, screen-up, toward-camera
const CAN_SCALE = 1;            // uniform scale

// --- Scene constants (mirror scenes/queue-1.js) ----------------------------
// CAMERA_DIR is queue-1's camera offset direction; we keep the 3/4 viewing angle
// but recompute the distance so the can fits the (short, wide) band region.
const CAMERA_DIR = [-10, 4, 11];
const CAMERA_FOV = 45;
const FIT_MARGIN = 1.15; // padding around the can when framing it into the band
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

const ENV_MAP_URL =
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r164/examples/textures/equirectangular/venice_sunset_1k.hdr';

const MODEL_PATH = 'bennyrizzo - 1950s-spam/source/Spam can.fbx';
const TEXTURE_PATH = 'bennyrizzo - 1950s-spam/textures/';

async function init() {
  // Run label.html's full builder wiring and grab the shared label build so the
  // can wears exactly what the page draws.
  const { lb } = await main();

  const overlay = document.getElementById('can-overlay');
  const wrap = document.getElementById('canvas-wrap');
  if (!overlay || !wrap) {
    console.error('label-can: #can-overlay or #canvas-wrap missing');
    return;
  }

  // --- Renderer (transparent so the band shows through behind the can) ---
  const renderer = new THREE.WebGLRenderer({ canvas: overlay, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // --- Scene (no background → fully transparent clear) ---
  const scene = new THREE.Scene();

  // --- Environment map ---
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  new RGBELoader().load(ENV_MAP_URL, (hdrEquirect) => {
    const envMap = pmremGenerator.fromEquirectangular(hdrEquirect).texture;
    scene.environment = envMap;
    hdrEquirect.dispose();
    pmremGenerator.dispose();
  });

  // --- Camera ---
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 1000);
  camera.position.set(...CAMERA_DIR);

  // --- Controls (orbit around the origin = the framed can centre) ---
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1;
  controls.maxDistance = 50;
  controls.target.set(0, 0, 0);

  // --- Lighting (mirrors queue-1) ---
  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));

  const hemiLight = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY);
  hemiLight.position.set(0, 10, 0);
  scene.add(hemiLight);

  const dirLight1 = new THREE.DirectionalLight(KEY_LIGHT_COLOR, KEY_LIGHT_INTENSITY);
  dirLight1.position.set(...KEY_LIGHT_POSITION);
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(FILL_LIGHT_COLOR, FILL_LIGHT_INTENSITY);
  dirLight2.position.set(...FILL_LIGHT_POSITION);
  scene.add(dirLight2);

  const dirLight3 = new THREE.DirectionalLight(0xffffff, RIM_LIGHT_INTENSITY);
  dirLight3.position.set(...RIM_LIGHT_POSITION);
  scene.add(dirLight3);

  // --- Can placement state (driven by the panel, baked via the constants) ---
  const canPlacement = { position: [...CAN_POSITION], scale: CAN_SCALE };
  let canPivot = null;       // wrapper recentred on the can; holds position+scale
  let applyStretchY = null;
  let referenceRadius = 1;   // can's unscaled bounding radius — frames the camera
  let fitted = false;

  // View basis captured from the camera (set in fitCamera). The placement
  // offset is applied along these so X/Y/Z track the screen, not world axes.
  const viewRight = new THREE.Vector3(1, 0, 0);
  const viewUp = new THREE.Vector3(0, 1, 0);
  const viewToCam = new THREE.Vector3(0, 0, 1);

  function round3(n) { return Math.round(n * 1000) / 1000; }

  function updateCoordsReadout() {
    const el = document.getElementById('can-coords');
    if (!el) return;
    const [x, y, z] = canPlacement.position;
    el.textContent =
      `CAN_POSITION = [${round3(x)}, ${round3(y)}, ${round3(z)}];  CAN_SCALE = ${round3(canPlacement.scale)};`;
  }

  // Place the pivot at controls.target plus a VIEW-space offset, so dialling X
  // slides the can along the screen horizontal, Y along the screen vertical, and
  // Z straight along the line of sight (depth) — never diagonally. The camera and
  // orbit target stay put, so the can visibly moves instead of the view recentring.
  function positionCanFromView() {
    if (!canPivot) return;
    const [x, y, z] = canPlacement.position;
    canPivot.position
      .copy(controls.target)
      .addScaledVector(viewRight, x)
      .addScaledVector(viewUp, y)
      .addScaledVector(viewToCam, z);
  }

  function applyPlacement() {
    if (canPivot) {
      positionCanFromView();
      canPivot.scale.setScalar(canPlacement.scale);
    }
    updateCoordsReadout();
  }

  // Frame the origin so the can (at scale 1, centred) fills the band rectangle.
  // Targets the origin (not the can's offset centre) so a baked CAN_POSITION
  // offset stays visible, and uses the scale-independent referenceRadius so the
  // frame is stable while you tweak scale. Re-runs on resize. Also caches the
  // camera's view basis (right/up/toward-camera) that placement offsets ride on.
  const _dir = new THREE.Vector3();
  function fitCamera() {
    const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    const limit = Math.min(vHalf, hHalf);
    const dist = (referenceRadius * FIT_MARGIN) / Math.sin(limit);
    _dir.set(...CAMERA_DIR).normalize().multiplyScalar(dist);
    controls.target.set(0, 0, 0);
    camera.position.copy(_dir);
    controls.update();

    camera.updateMatrixWorld();
    viewRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    viewUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    viewToCam.setFromMatrixColumn(camera.matrixWorld, 2).normalize();
    positionCanFromView();
  }

  // Keep the renderer buffer + camera aspect matched to the on-screen band
  // rectangle. CSS (inset:0; width/height:100%) owns the display size — pass
  // updateStyle=false. Returns true when the size actually changed.
  let lastW = 0, lastH = 0;
  function resizeOverlay() {
    const w = Math.max(1, Math.round(wrap.clientWidth));
    const h = Math.max(1, Math.round(wrap.clientHeight));
    if (w === lastW && h === lastH) return false;
    lastW = w;
    lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    return true;
  }

  // --- Placement panel wiring ---
  function syncPair(sliderId, numberId, value) {
    const slider = document.getElementById(sliderId);
    const number = document.getElementById(numberId);
    if (slider) slider.value = String(value);
    if (number) number.value = String(value);
  }
  function wireAxis(axisIndex, sliderId, numberId) {
    const slider = document.getElementById(sliderId);
    const number = document.getElementById(numberId);
    const set = (raw) => {
      const v = parseFloat(raw);
      if (!Number.isFinite(v)) return;
      canPlacement.position[axisIndex] = v;
      syncPair(sliderId, numberId, v);
      applyPlacement();
    };
    if (slider) slider.addEventListener('input', () => set(slider.value));
    if (number) number.addEventListener('input', () => set(number.value));
  }
  function wireScale() {
    const slider = document.getElementById('can-scale');
    const number = document.getElementById('can-scale-input');
    const set = (raw) => {
      const v = parseFloat(raw);
      if (!Number.isFinite(v) || v <= 0) return;
      canPlacement.scale = v;
      syncPair('can-scale', 'can-scale-input', v);
      applyPlacement();
    };
    if (slider) slider.addEventListener('input', () => set(slider.value));
    if (number) number.addEventListener('input', () => set(number.value));
  }
  // Seed the inputs from the baked defaults so the panel reflects them.
  syncPair('can-x', 'can-x-input', canPlacement.position[0]);
  syncPair('can-y', 'can-y-input', canPlacement.position[1]);
  syncPair('can-z', 'can-z-input', canPlacement.position[2]);
  syncPair('can-scale', 'can-scale-input', canPlacement.scale);
  wireAxis(0, 'can-x', 'can-x-input');
  wireAxis(1, 'can-y', 'can-y-input');
  wireAxis(2, 'can-z', 'can-z-input');
  wireScale();
  updateCoordsReadout();

  const copyBtn = document.getElementById('can-coords-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const el = document.getElementById('can-coords');
      if (!el || !navigator.clipboard) return;
      navigator.clipboard.writeText(el.textContent).then(() => {
        const prev = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = prev; }, 1200);
      }).catch(() => {});
    });
  }

  // --- Can: shares the page's label build, mirrors it on every repaint ---
  loadCan({
    modelPath: MODEL_PATH,
    texturePath: TEXTURE_PATH,
    labelBuild: lb,
    onLoaded({ canGroup: group, material, activateLabel }) {
      material.envMapIntensity = ENV_MAP_INTENSITY;

      // Turn on full-label mode without driving the builder; label.js owns lb,
      // and the can re-blits the band on every builder repaint (setOnDraw).
      activateLabel();

      // Recentre the can on a pivot so placement position/scale act about its
      // centre (the baked geometry sits off-origin otherwise).
      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      referenceRadius = box.getBoundingSphere(new THREE.Sphere()).radius;
      group.position.sub(center);

      const pivot = new THREE.Group();
      pivot.add(group);
      scene.add(pivot);
      canPivot = pivot;
      applyPlacement(); // apply CAN_POSITION / CAN_SCALE defaults

      const loadingEl = document.getElementById('loading');
      if (loadingEl) loadingEl.classList.add('hidden');

      // Band height → can Y-stretch (same mapping as can.js setArtworkEntry),
      // operating on the restPositions loadCan baked in. Mirrors queue-1. The
      // stretch is symmetric about the can's centre, so it stays centred on the
      // pivot.
      const originalHeight = box.getSize(new THREE.Vector3()).y;

      applyStretchY = function (stretchFactor) {
        if (!Number.isFinite(stretchFactor) || stretchFactor <= 0) return;
        const targetHeight = originalHeight * stretchFactor;
        const deltaY = (targetHeight - originalHeight) / 2;

        let minY = Infinity, maxY = -Infinity;
        group.traverse((child) => {
          if (!child.isMesh || !child.userData.restPositions) return;
          const rest = child.userData.restPositions;
          for (let i = 1; i < rest.length; i += 3) {
            minY = Math.min(minY, rest[i]);
            maxY = Math.max(maxY, rest[i]);
          }
        });
        const centerY = (minY + maxY) / 2;

        group.traverse((child) => {
          if (!child.isMesh || !child.userData.restPositions) return;
          const rest = child.userData.restPositions;
          const pos = child.geometry.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            const restX = rest[i * 3];
            const restY = rest[i * 3 + 1];
            const restZ = rest[i * 3 + 2];
            const newY = restY < centerY ? restY - deltaY : restY + deltaY;
            pos.setXYZ(i, restX, newY, restZ);
          }
          pos.needsUpdate = true;
          child.geometry.computeVertexNormals();
        });
      };
    },
  });

  // --- Render loop ---
  let lastBand = -1;
  function animate() {
    requestAnimationFrame(animate);
    const resized = resizeOverlay();

    // Mirror band-height changes (artwork fit, drag handle, Height input) onto
    // the can's Y-stretch.
    if (canPivot && applyStretchY && lb.bandHeight !== lastBand) {
      lastBand = lb.bandHeight;
      applyStretchY(lb.bandHeight / REF_HEIGHT);
    }

    // Frame once the band rectangle has a real size, and re-frame on resize.
    if (canPivot && lastW > 0 && lastH > 0 && (!fitted || resized)) {
      fitCamera();
      fitted = true;
    }

    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', resizeOverlay);
}

init();
