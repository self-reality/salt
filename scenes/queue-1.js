import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadCan } from '../lib/can.js';
import { setupPixelArtPass } from '../lib/post-processing.js';
import {
  buildRandomManifestFromDataset,
  buildEntryFromDatasetItem,
  findArtistInDataset,
  waveSortManifest,
  insertIndexInWave,
} from '../lib/dataset.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const ARTWORK_BASE_PATH = 'artworks/';
const INTERVAL_MS = 100;
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
export async function runQueue1Scene() {
  const controlsPanel = document.getElementById('controls-panel');
  if (controlsPanel) controlsPanel.classList.add('hidden');

  const requestedArtist = new URLSearchParams(location.search).get('artist');

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

  // --- Camera ---
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(...CAMERA_POSITION);

  // --- Controls ---
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = false;
  controls.minDistance = 1;
  controls.maxDistance = 20;

  // Clamp closest zoom so the model can't grow beyond the agreed maximum.
  // Assumption: projected on-screen size scales ~ inversely with camera distance.
  // Current scale is 30% at the initial camera position; we cap at 50%.
  {
    const currentScale = 0.3;
    const maxScale = 0.5;

    // Ensure distance is measured from the orbit target.
    controls.target.set(0, 0, 0);
    const currentDistance = camera.position.distanceTo(controls.target);
    const rawMinDistance = currentDistance * (currentScale / maxScale);

    let minDistance = rawMinDistance;
    if (!Number.isFinite(minDistance) || minDistance <= 0) minDistance = 1;

    // Guardrail: keep minDistance slightly below maxDistance.
    const maxDistance = controls.maxDistance;
    if (!Number.isFinite(maxDistance) || maxDistance <= 0) controls.maxDistance = 20;
    if (minDistance >= controls.maxDistance) minDistance = controls.maxDistance - 0.001;

    controls.minDistance = minDistance;
  }

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
  const queueUI = document.getElementById('queue-ui');
  const overlay = document.getElementById('queue-overlay');
  const pauseButton = document.getElementById('queue-pause');
  const searchInput = document.getElementById('queue-search-input');
  const searchButton = document.getElementById('queue-search-btn');
  const searchContainer = document.getElementById('queue-search');

  // --- Load can ---
  loadCan({
    modelPath: MODEL_PATH,
    texturePath: TEXTURE_PATH,
    onLoaded({ canGroup, material, setArtworkFromImage, width, height, depth }) {
      material.envMapIntensity = ENV_MAP_INTENSITY;
      scene.add(canGroup);
      controls.target.set(0, 0, 0);
      controls.update();

      const loadingEl = document.getElementById('loading');
      if (loadingEl) loadingEl.classList.add('hidden');

      // Show queue UI
      if (queueUI) queueUI.classList.add('visible');

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
      let isPaused = false;
      let artworkIntervalId = null;
      let hasStartedArtwork = false;
      let requestedArtistHandled = false;

      function updateOverlay(item) {
        if (overlay) overlay.innerHTML = `${item.username}<br>${item.name}`;
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

      function stopArtworkLoop() {
        if (!artworkIntervalId) return;
        window.clearInterval(artworkIntervalId);
        artworkIntervalId = null;
      }

      function positionPauseButton() {
        if (!overlay || !pauseButton) return;
        const overlayRect = overlay.getBoundingClientRect();
        const buttonRect = pauseButton.getBoundingClientRect();
        const overlayBottomFromViewportBottom = window.innerHeight - overlayRect.bottom;
        const gapPx = 6;
        const newBottom = overlayBottomFromViewportBottom - (buttonRect.height + gapPx);
        pauseButton.style.bottom = `${Math.max(8, newBottom)}px`;

        if (searchContainer) {
          const pauseBottom = parseFloat(pauseButton.style.bottom);
          const searchBottom = pauseBottom - searchContainer.getBoundingClientRect().height - gapPx;
          searchContainer.style.bottom = `${Math.max(8, searchBottom)}px`;
        }
      }

      function pauseOnIndex(index) {
        if (!validItems.length) return;
        seqIndex = index;
        applyArtworkByIndex(seqIndex);
        isPaused = true;
        stopArtworkLoop();
        if (pauseButton) {
          pauseButton.textContent = 'Play';
          pauseButton.setAttribute('aria-label', 'Play artwork cycling');
        }
      }

      // Pause button
      if (pauseButton) {
        pauseButton.addEventListener('click', () => {
          isPaused = !isPaused;
          pauseButton.textContent = isPaused ? 'Play' : 'Pause';
          pauseButton.setAttribute(
            'aria-label',
            isPaused ? 'Play artwork cycling' : 'Pause artwork cycling',
          );
          if (isPaused) stopArtworkLoop();
          else startArtworkLoop();
        });
      }

      // Search
      let searchBusy = false;
      function performSearch() {
        const query = searchInput?.value.trim();
        if (!query || searchBusy) return;
        const match = findArtistInDataset(fullDataset, query);
        if (!match) {
          if (searchInput) {
            searchInput.style.borderColor = 'rgba(255,80,80,0.8)';
            searchInput.placeholder = 'Not found';
            searchInput.value = '';
            setTimeout(() => {
              searchInput.style.borderColor = 'rgba(255,255,255,0.2)';
              searchInput.placeholder = 'Artist name…';
            }, 1500);
          }
          return;
        }
        searchBusy = true;
        if (searchButton) searchButton.textContent = '…';
        const item = buildEntryFromDatasetItem(match);
        if (!item) { searchBusy = false; if (searchButton) searchButton.textContent = 'Search'; return; }
        preloadLocalArtwork(
          item,
          (img) => {
            const ar = item.height / item.width;
            const insertIdx = insertIndexInWave(validItems, ar);
            validItems.splice(insertIdx, 0, img);
            pauseOnIndex(insertIdx);
            positionPauseButton();
            if (searchInput) searchInput.value = '';
            searchBusy = false;
            if (searchButton) searchButton.textContent = 'Search';
          },
          () => {
            if (searchInput) {
              searchInput.style.borderColor = 'rgba(255,80,80,0.8)';
              searchInput.placeholder = 'Artwork not found';
              searchInput.value = '';
              setTimeout(() => {
                searchInput.style.borderColor = 'rgba(255,255,255,0.2)';
                searchInput.placeholder = 'Artist name…';
              }, 1500);
            }
            searchBusy = false;
            if (searchButton) searchButton.textContent = 'Search';
          },
        );
      }

      if (searchButton) searchButton.addEventListener('click', performSearch);
      if (searchInput) searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') performSearch();
      });

      // First-load start
      function maybeStartFromFirstLoadedArtwork() {
        if (hasStartedArtwork || !validItems.length) return;
        stopArtworkLoop();
        seqIndex = 0;
        applyArtworkByIndex(seqIndex);
        positionPauseButton();
        hasStartedArtwork = true;
        if (!isPaused) startArtworkLoop();
      }

      // Requested artist via ?artist= param
      function maybeHandleRequestedArtist() {
        if (requestedArtistHandled || !requestedArtist) return;
        requestedArtistHandled = true;
        const match = findArtistInDataset(fullDataset, requestedArtist);
        if (!match) return;
        const item = buildEntryFromDatasetItem(match);
        if (!item) return;
        preloadLocalArtwork(
          item,
          (img) => {
            const ar = item.height / item.width;
            const insertIdx = insertIndexInWave(validItems, ar);
            validItems.splice(insertIdx, 0, img);
            pauseOnIndex(insertIdx);
            positionPauseButton();
          },
          () => console.warn(`Requested artist artwork not found: ${item.username}`),
        );
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

      function preloadLocalArtwork(item, onSuccess, onFailure) {
        const img = new Image();
        img._item = item;
        img.onload = () => onSuccess(img);
        img.onerror = () => onFailure(item.filename);
        img.src = ARTWORK_BASE_PATH + item.filename;
      }

      maybeHandleRequestedArtist();

      for (let i = 0; i < manifest.length; i++) {
        const item = manifest[i];
        preloadLocalArtwork(
          item,
          (img) => {
            if (!preloaded[i]) {
              preloaded[i] = img;
              insertManifestImageInOrder(img, i);
              maybeStartFromFirstLoadedArtwork();
            }
            loadedCount++;
            if (loadedCount === manifest.length && validItems.length === 0) {
              console.warn('No artwork images loaded successfully from manifest.');
            }
          },
          (filename) => {
            console.warn(
              `Artwork not found in /artworks: ${filename} (${item.username} — "${item.name}")`,
            );
            loadedCount++;
            if (loadedCount === manifest.length && validItems.length === 0) {
              console.warn('No artwork images loaded successfully from manifest.');
            }
          },
        );
      }

      window.addEventListener('resize', positionPauseButton);
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
