// -----------------------------------------------------------------------------
// label-can.js — label.html's builder + a live 3D can floating over the band.
//
// Reuses label.js's entire control wiring (artwork picker, colours, variables,
// band-height drag) via its exported main(), and overlays a transparent Three.js
// can — borrowing scenes/queue-1.js's lighting / env map / camera / orbit setup —
// that mirrors the same shared label build. Editing any control repaints both the
// flat band (page background) and the wrapped can (foreground) together. The can
// is framed to fit the on-screen band rectangle, centred over the label.
// -----------------------------------------------------------------------------

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadCan } from './lib/can.js';
import { REF_HEIGHT } from './lib/label-texture.js';
import { main } from './label.js';

// --- Scene constants (mirror scenes/queue-1.js) ----------------------------
// CAMERA_DIR is queue-1's camera offset from the can; we keep the 3/4 viewing
// angle but recompute the distance so the can fits the (short, wide) band.
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

  // --- Controls ---
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

  let canGroup = null;
  let applyStretchY = null;

  // Keep the renderer buffer + camera aspect matched to the on-screen band
  // rectangle, so the can is "limited by the label" and centred over it. CSS
  // (inset:0; width/height:100%) owns the display size — pass updateStyle=false.
  // Returns true when the size actually changed.
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

  // Frame the can so it fills the band rectangle, centred — keeping the current
  // view direction (queue-1's 3/4 angle, or whatever the user orbited to). The
  // viewport is wide and short, so the vertical FOV is usually the limit; we fit
  // the can's bounding sphere to whichever half-angle (vertical/horizontal) is
  // smaller, then point OrbitControls at the can's centre.
  const _box = new THREE.Box3();
  const _sphere = new THREE.Sphere();
  const _dir = new THREE.Vector3();
  function fitCameraToCan() {
    if (!canGroup) return;
    _box.setFromObject(canGroup);
    if (_box.isEmpty()) return;
    _box.getBoundingSphere(_sphere);
    const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    const limit = Math.min(vHalf, hHalf);
    const dist = (_sphere.radius * FIT_MARGIN) / Math.sin(limit);

    _dir.copy(camera.position).sub(controls.target);
    if (_dir.lengthSq() === 0) _dir.set(...CAMERA_DIR);
    _dir.normalize().multiplyScalar(dist);

    controls.target.copy(_sphere.center);
    camera.position.copy(_sphere.center).add(_dir);
    controls.update();
  }

  // --- Can: shares the page's label build, mirrors it on every repaint ---
  loadCan({
    modelPath: MODEL_PATH,
    texturePath: TEXTURE_PATH,
    labelBuild: lb,
    onLoaded({ canGroup: group, material, activateLabel }) {
      material.envMapIntensity = ENV_MAP_INTENSITY;
      scene.add(group);
      canGroup = group;

      // Turn on full-label mode without driving the builder; label.js owns lb,
      // and the can re-blits the band on every builder repaint (setOnDraw).
      activateLabel();

      const loadingEl = document.getElementById('loading');
      if (loadingEl) loadingEl.classList.add('hidden');

      // Band height → can Y-stretch (same mapping as can.js setArtworkEntry),
      // operating on the restPositions loadCan baked in. Mirrors queue-1.
      const box0 = new THREE.Box3().setFromObject(group);
      const originalHeight = box0.getSize(new THREE.Vector3()).y;

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
    let needFit = resizeOverlay();

    // Mirror band-height changes (artwork fit, drag handle, Height input) onto
    // the can's Y-stretch, then reframe.
    if (canGroup && applyStretchY && lb.bandHeight !== lastBand) {
      lastBand = lb.bandHeight;
      applyStretchY(lb.bandHeight / REF_HEIGHT);
      needFit = true;
    }

    if (needFit) fitCameraToCan();
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', resizeOverlay);
}

init();
