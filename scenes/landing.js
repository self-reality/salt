import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadCan } from '../lib/can.js';
import { setupPixelArtPass } from '../lib/post-processing.js';
import {
  buildRandomManifestFromDataset,
  waveSortManifest,
} from '../lib/dataset.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const ARTWORK_BASE_PATH = 'artworks/';
const INTERVAL_MS = 3000;
const CAMERA_POSITION = [-10, 4, 11];
const CAMERA_FOV = 45;
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

const ENV_MAP_URL =
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r164/examples/textures/equirectangular/venice_sunset_1k.hdr';

const MODEL_PATH = 'bennyrizzo - 1950s-spam/source/Spam can.fbx';
const TEXTURE_PATH = 'bennyrizzo - 1950s-spam/textures/';
const DATASET_PATH = 'queue/most-expensive-artworks.json';
const SAMPLE_SIZE = 50;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
export async function runLandingScene() {
  // Hide elements not used by landing
  const controlsPanel = document.getElementById('controls-panel');
  if (controlsPanel) controlsPanel.classList.add('hidden');
  const landingHeader = document.getElementById('landing-header');
  if (landingHeader) landingHeader.classList.add('hidden');

  // Show landing page and enable scrolling
  const landingPage = document.getElementById('landing-page');
  if (landingPage) landingPage.classList.add('visible');
  document.documentElement.style.overflow = 'auto';
  document.body.style.overflow = 'auto';

  // Build manifest
  const fullDataset = await fetch(DATASET_PATH).then((r) => r.json());
  const manifest = waveSortManifest(
    buildRandomManifestFromDataset(fullDataset, SAMPLE_SIZE),
  );

  // --- Renderer ---
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const canvas = renderer.domElement;
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.zIndex = '0';
  canvas.style.pointerEvents = 'none';
  document.body.appendChild(canvas);

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

  // --- Camera ---
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(...CAMERA_POSITION);

  // --- Controls (bound to #can-zone, panning disabled) ---
  const canZone = document.getElementById('can-zone');
  const controls = new OrbitControls(camera, canZone);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  controls.enablePan = false;
  controls.minDistance = 1;
  controls.maxDistance = 20;

  // Soft zoom limits for rubber-band effect
  let softMinDistance, softMaxDistance;
  {
    const currentScale = 0.3;
    const maxScale = 0.5;

    controls.target.set(0, 0, 0);
    const currentDistance = camera.position.distanceTo(controls.target);
    const rawMinDistance = currentDistance * (currentScale / maxScale);

    let minDistance = rawMinDistance;
    if (!Number.isFinite(minDistance) || minDistance <= 0) minDistance = 1;

    const maxDistance = controls.maxDistance;
    if (!Number.isFinite(maxDistance) || maxDistance <= 0) controls.maxDistance = 20;
    if (minDistance >= controls.maxDistance) minDistance = controls.maxDistance - 0.001;

    softMinDistance = minDistance;
    softMaxDistance = controls.maxDistance;

    controls.minDistance = softMinDistance * 0.4;
    controls.maxDistance = softMaxDistance * 1.5;
  }

  // --- Rubber-band scroll tracking (on can-zone) ---
  let userScrolling = false;
  let _scrollEndTimer = null;
  const SCROLL_END_DELAY = 150;

  function _markScrolling() {
    userScrolling = true;
    clearTimeout(_scrollEndTimer);
    _scrollEndTimer = setTimeout(() => { userScrolling = false; }, SCROLL_END_DELAY);
  }

  canZone.addEventListener('wheel', _markScrolling, { passive: true });
  canZone.addEventListener('touchmove', (e) => {
    if (e.touches.length >= 2) _markScrolling();
  }, { passive: true });

  // --- Lighting ---
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

  // --- Post-processing ---
  const { composer, pixelArtPass } = setupPixelArtPass(renderer, scene, camera);
  pixelArtPass.uniforms.pixelSize.value = 4;
  pixelArtPass.uniforms.colorLevels.value = 8;

  // --- DOM references ---
  const artworkInfo = document.getElementById('landing-artwork-info');

  // --- Load can ---
  loadCan({
    modelPath: MODEL_PATH,
    texturePath: TEXTURE_PATH,
    onLoaded({ canGroup, material, setArtworkFromImage, width, height }) {
      material.envMapIntensity = ENV_MAP_INTENSITY;
      scene.add(canGroup);
      controls.target.set(0, 0, 0);
      controls.update();

      const loadingEl = document.getElementById('loading');
      if (loadingEl) loadingEl.classList.add('hidden');

      // Stretch state
      const originalHeight = height;

      function applyStretchY(stretchFactor) {
        if (!Number.isFinite(stretchFactor) || stretchFactor <= 0) return;

        const targetHeight = originalHeight * stretchFactor;
        const deltaY = (targetHeight - originalHeight) / 2;

        let minY = Infinity, maxY = -Infinity;
        canGroup.traverse((child) => {
          if (!child.isMesh || !child.userData.restPositions) return;
          const rest = child.userData.restPositions;
          for (let i = 1; i < rest.length; i += 3) {
            minY = Math.min(minY, rest[i]);
            maxY = Math.max(maxY, rest[i]);
          }
        });

        const centerY = (minY + maxY) / 2;

        canGroup.traverse((child) => {
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
      }

      // Artwork cycling state
      const preloaded = new Array(manifest.length);
      let loadedCount = 0;
      let validItems = [];
      let seqIndex = 0;
      let artworkIntervalId = null;
      let hasStartedArtwork = false;

      function updateOverlay(item) {
        if (artworkInfo) artworkInfo.textContent = `${item.username} — ${item.name}`;
      }

      function applyArtworkByIndex(index) {
        if (!validItems.length) return;
        const safeIndex = ((index % validItems.length) + validItems.length) % validItems.length;
        const item = validItems[safeIndex];
        setArtworkFromImage(item, applyStretchY);
        updateOverlay(item._item);
      }

      function startArtworkLoop() {
        if (!validItems.length || artworkIntervalId) return;
        artworkIntervalId = window.setInterval(() => {
          seqIndex = (seqIndex + 1) % validItems.length;
          applyArtworkByIndex(seqIndex);
        }, INTERVAL_MS);
      }

      function insertManifestImageInOrder(img, manifestIndex) {
        img._manifestIndex = manifestIndex;
        let insertIdx = validItems.length;
        for (let i = 0; i < validItems.length; i++) {
          const existingManifestIndex = validItems[i]._manifestIndex;
          if (Number.isInteger(existingManifestIndex) && existingManifestIndex > manifestIndex) {
            insertIdx = i;
            break;
          }
        }
        validItems.splice(insertIdx, 0, img);
      }

      function maybeStartFromFirstLoadedArtwork() {
        if (hasStartedArtwork || !validItems.length) return;
        seqIndex = 0;
        applyArtworkByIndex(seqIndex);
        hasStartedArtwork = true;
        startArtworkLoop();
      }

      // Preload artworks
      for (let i = 0; i < manifest.length; i++) {
        const item = manifest[i];
        const img = new Image();
        img._item = item;
        img.onload = () => {
          if (!preloaded[i]) {
            preloaded[i] = img;
            insertManifestImageInOrder(img, i);
            maybeStartFromFirstLoadedArtwork();
          }
          loadedCount++;
        };
        img.onerror = () => {
          loadedCount++;
        };
        img.src = ARTWORK_BASE_PATH + item.filename;
      }
    },
  });

  // --- Render loop ---
  const clock = new THREE.Clock();
  const _rbOffset = new THREE.Vector3();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    controls.update();

    // Rubber-band zoom correction
    _rbOffset.subVectors(camera.position, controls.target);
    const dist = _rbOffset.length();

    let clampTarget = -1;
    if (dist < softMinDistance) clampTarget = softMinDistance;
    else if (dist > softMaxDistance) clampTarget = softMaxDistance;

    if (clampTarget >= 0) {
      const rate = userScrolling ? 4 : 12;
      const t = 1 - Math.exp(-rate * dt);
      let newDist = dist + (clampTarget - dist) * t;
      if (Math.abs(newDist - clampTarget) < 0.001) newDist = clampTarget;

      _rbOffset.normalize().multiplyScalar(newDist);
      camera.position.copy(controls.target).add(_rbOffset);
    }

    composer.render();
  }
  animate();

  // --- Resize ---
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    pixelArtPass.uniforms.resolution.value.set(
      window.innerWidth * renderer.getPixelRatio(),
      window.innerHeight * renderer.getPixelRatio(),
    );
  });
}
