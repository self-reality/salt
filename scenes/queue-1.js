import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadCan } from '../lib/can.js';
import { setupPixelArtPass } from '../lib/post-processing.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const ARTWORK_BASE_PATH = 'artworks/';
const INTERVAL_MS = 100;
const CAMERA_POSITION = [0, 1, 4.5];
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
const QUEUE_PATH = 'queue/queue-1-manifest.json';

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
export async function runQueue1Scene() {
  // This scene shouldn't show the global controls UI.
  const controlsPanel = document.getElementById('controls-panel');
  if (controlsPanel) controlsPanel.classList.add('hidden');

  // Load manifest
  const manifest = await fetch(QUEUE_PATH).then((r) => r.json());

  // Sort by aspect ratio descending (tallest first)
  manifest.sort((a, b) => (b.height / b.width) - (a.height / a.width));

  // Arrange as wave: tallest → widest → tallest (seamless loop)
  // Even-indexed sorted items descend (tall→wide), odd-indexed reversed ascend (wide→tall)
  const sorted = manifest.slice();
  const descHalf = [];
  const ascHalf = [];
  for (let i = 0; i < sorted.length; i++) {
    (i % 2 === 0 ? descHalf : ascHalf).push(sorted[i]);
  }
  ascHalf.reverse();
  manifest.length = 0;
  manifest.push(...descHalf, ...ascHalf);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);

  // Environment map
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  new RGBELoader().load(ENV_MAP_URL, (hdrEquirect) => {
    const envMap = pmremGenerator.fromEquirectangular(hdrEquirect).texture;
    scene.environment = envMap;
    hdrEquirect.dispose();
    pmremGenerator.dispose();
  });

  // Camera
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(...CAMERA_POSITION);

  // Orbit controls (mouse rotation only, no auto-rotate)
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = false;
  controls.minDistance = 1;
  controls.maxDistance = 20;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
  scene.add(ambientLight);

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

  // Post-processing (hardcoded defaults from test scene tuning)
  const { composer, pixelArtPass } = setupPixelArtPass(renderer, scene, camera);
  pixelArtPass.uniforms.pixelSize.value = 4;
  pixelArtPass.uniforms.colorLevels.value = 8;

  // Load can
  loadCan({
    modelPath: MODEL_PATH,
    texturePath: TEXTURE_PATH,
    onLoaded({ canGroup, material, setArtworkFromUrl, setArtworkFromImage, width, height, depth }) {
      material.envMapIntensity = ENV_MAP_INTENSITY;
      scene.add(canGroup);

      controls.target.set(0, 0, 0);
      controls.update();

      const loadingEl = document.getElementById('loading');
      if (loadingEl) loadingEl.classList.add('hidden');

      // Stretch state (same logic as controls.js but inline)
      const originalWidth = width;
      const originalHeight = height;
      const originalDepth = depth;

      function applyStretchY(stretchFactor) {
        if (!Number.isFinite(stretchFactor) || stretchFactor <= 0) return;

        const targetHeight = originalHeight * stretchFactor;
        const deltaY = (targetHeight - originalHeight) / 2;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        canGroup.traverse((child) => {
          if (!child.isMesh || !child.userData.restPositions) return;
          const rest = child.userData.restPositions;
          for (let i = 0; i < rest.length; i += 3) {
            minX = Math.min(minX, rest[i]);
            maxX = Math.max(maxX, rest[i]);
            minY = Math.min(minY, rest[i + 1]);
            maxY = Math.max(maxY, rest[i + 1]);
            minZ = Math.min(minZ, rest[i + 2]);
            maxZ = Math.max(maxZ, rest[i + 2]);
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

      // Preload all artwork images into memory, then start the loop
      const preloaded = new Array(manifest.length);
      let loadedCount = 0;

      // Text overlay
      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed',
        bottom: '166px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.85)',
        color: '#fff',
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: '13px',
        lineHeight: '1.5',
        padding: '8px 16px',
        borderRadius: '8px',
        textAlign: 'center',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: '1000',
      });
      document.body.appendChild(overlay);

      function updateOverlay(item) {
        overlay.innerHTML = `${item.username}<br>${item.name}`;
      }

      function onAllPreloaded() {
        // Filter out failed loads
        const validItems = [];
        for (let i = 0; i < manifest.length; i++) {
          if (preloaded[i]) validItems.push(preloaded[i]);
        }
        if (validItems.length === 0) return;

        let seqIndex = 0;
        setArtworkFromImage(validItems[0], applyStretchY);
        updateOverlay(validItems[0]._item);

        setInterval(() => {
          seqIndex = (seqIndex + 1) % validItems.length;
          setArtworkFromImage(validItems[seqIndex], applyStretchY);
          updateOverlay(validItems[seqIndex]._item);
        }, INTERVAL_MS);
      }

      for (let i = 0; i < manifest.length; i++) {
        const item = manifest[i];
        const img = new Image();
        img._item = item;
        img.onload = () => {
          preloaded[i] = img;
          loadedCount++;
          if (loadedCount === manifest.length) onAllPreloaded();
        };
        img.onerror = () => {
          console.warn(`Artwork not found: ${ARTWORK_BASE_PATH + item.filename} (${item.username} — "${item.name}")`);
          loadedCount++;
          if (loadedCount === manifest.length) onAllPreloaded();
        };
        img.src = ARTWORK_BASE_PATH + item.filename;
      }
    },
  });

  // Render loop
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    composer.render();
  }
  animate();

  // Resize
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
