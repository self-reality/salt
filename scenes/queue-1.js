import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadCan } from '../lib/can.js';
import { setupPixelArtPass } from '../lib/post-processing.js';
import { waveSortManifest, findArtistInManifest } from '../lib/dataset.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const PRERENDER_BASE = 'prerender-out/';
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
const MANIFEST_PATH = 'prerender-out/manifest.json';

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
export async function runQueue1Scene() {
  const controlsPanel = document.getElementById('controls-panel');
  if (controlsPanel) controlsPanel.classList.add('hidden');

  const requestedArtist = new URLSearchParams(location.search).get('artist');

  // Prebaked cans: source the carousel straight from the prerender manifest.
  const manifestData = await fetch(MANIFEST_PATH).then((r) => r.json());
  const entries = waveSortManifest(
    (manifestData.entries || []).filter((e) => e.texture && !e.error),
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

  // Soft zoom limits for the rubber-band effect.
  // Derived from constants + initial camera distance (not from can geometry).
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

    // Widen hard limits so OrbitControls allows overshoot into the rubber-band zone.
    controls.minDistance = softMinDistance * 0.4;
    controls.maxDistance = softMaxDistance * 1.5;
  }

  // --- Rubber-band scroll tracking ---
  let userScrolling = false;
  let _scrollEndTimer = null;
  const SCROLL_END_DELAY = 150;

  function _markScrolling() {
    userScrolling = true;
    clearTimeout(_scrollEndTimer);
    _scrollEndTimer = setTimeout(() => { userScrolling = false; }, SCROLL_END_DELAY);
  }

  renderer.domElement.addEventListener('wheel', _markScrolling, { passive: true });
  renderer.domElement.addEventListener('touchmove', (e) => {
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
  const queueUI = document.getElementById('queue-ui');
  const overlay = document.getElementById('queue-overlay');
  const pauseButton = document.getElementById('queue-pause');
  const searchInput = document.getElementById('queue-search-input');
  const searchButton = document.getElementById('queue-search-btn');
  const searchContainer = document.getElementById('queue-search');

  // --- Load can (prebaked: textures come straight from prerender-out) ---
  loadCan({
    modelPath: MODEL_PATH,
    texturePath: TEXTURE_PATH,
    baked: true,
    onLoaded({ canGroup, material, setBakedTexture, preloadBakedTexture, height }) {
      material.envMapIntensity = ENV_MAP_INTENSITY;
      scene.add(canGroup);
      controls.target.set(0, 0, 0);
      controls.update();

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

      // Artwork cycling state — driven entirely by the prebaked manifest.
      const validItems = entries;
      let seqIndex = 0;
      let isPaused = false;
      let artworkIntervalId = null;

      // Warm every baked texture so swaps during the loop are instant.
      for (const e of validItems) preloadBakedTexture(PRERENDER_BASE + e.texture);

      function updateOverlay(entry) {
        if (overlay) overlay.innerHTML = `${entry.author}<br>${entry.title}`;
      }

      function applyArtworkByIndex(index) {
        if (!validItems.length) return;
        const safeIndex = ((index % validItems.length) + validItems.length) % validItems.length;
        const entry = validItems[safeIndex];
        setBakedTexture(PRERENDER_BASE + entry.texture);
        applyStretchY(entry.stretchY);
        updateOverlay(entry);
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

      // Search (restricted to the baked set)
      function showSearchNotFound(message) {
        if (!searchInput) return;
        searchInput.style.borderColor = 'rgba(255,80,80,0.8)';
        searchInput.placeholder = message;
        searchInput.value = '';
        setTimeout(() => {
          searchInput.style.borderColor = 'rgba(255,255,255,0.2)';
          searchInput.placeholder = 'Artist name…';
        }, 1500);
      }
      function performSearch() {
        const query = searchInput?.value.trim();
        if (!query) return;
        const match = findArtistInManifest(validItems, query);
        if (!match) { showSearchNotFound('Not found'); return; }
        pauseOnIndex(validItems.indexOf(match));
        positionPauseButton();
        if (searchInput) searchInput.value = '';
      }

      if (searchButton) searchButton.addEventListener('click', performSearch);
      if (searchInput) searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') performSearch();
      });

      // Kick off the carousel. Everything's already preloaded, so apply the
      // first baked texture before hiding the loader to avoid a white-can flash.
      if (validItems.length) {
        seqIndex = 0;
        applyArtworkByIndex(seqIndex);
        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.classList.add('hidden');
        if (queueUI) queueUI.classList.add('visible');
        positionPauseButton();
        if (!isPaused) startArtworkLoop();

        // Optional ?artist= deep-link, restricted to the baked set.
        if (requestedArtist) {
          const match = findArtistInManifest(validItems, requestedArtist);
          if (match) pauseOnIndex(validItems.indexOf(match));
          else console.warn(`Requested artist not in baked set: ${requestedArtist}`);
        }
      } else {
        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.textContent = 'No pregenerated cans found.';
        console.warn('No baked cans available in manifest.');
      }

      window.addEventListener('resize', positionPauseButton);
    },
  });

  // Render loop (with rubber-band zoom correction)
  const clock = new THREE.Clock();
  const _rbOffset = new THREE.Vector3();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    controls.update();

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
