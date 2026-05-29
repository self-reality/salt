import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { loadCan } from '../lib/can.js';
import { loadLabelAssets, createLabelBuild } from '../lib/label-build.js';
import {
  buildRandomManifestFromDataset,
  buildEntryFromDatasetItem,
  findArtistInDataset,
  waveSortManifest,
  insertIndexInWave,
} from '../lib/dataset.js';

// ---------------------------------------------------------------------------
// Asset paths
// ---------------------------------------------------------------------------
const VAN_GLB_PATH = 'van/apocalyptic-old-van-driveable-with-interior/source/Van.glb';
const CAN_FBX_PATH = 'bennyrizzo - 1950s-spam/source/Spam can.fbx';
const CAN_TEXTURE_PATH = 'bennyrizzo - 1950s-spam/textures/';
const ARTWORK_BASE_PATH = 'artworks/';
const DATASET_PATH = 'queue/most-expensive-artworks.json';
const SAMPLE_SIZE = 50;
const INTERVAL_MS = 300;

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
export async function runVanCanScene() {
  // Hide DOM elements only used by other scenes.
  for (const id of ['controls-panel']) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  const requestedArtist = new URLSearchParams(location.search).get('artist');

  // Build manifest from dataset (used to cycle artworks onto the can label).
  const fullDataset = await fetch(DATASET_PATH).then((r) => r.json());
  const manifest = waveSortManifest(
    buildRandomManifestFromDataset(fullDataset, SAMPLE_SIZE),
  );

  // --- Queue UI DOM references ---
  const queueUI = document.getElementById('queue-ui');
  const overlay = document.getElementById('queue-overlay');
  const pauseButton = document.getElementById('queue-pause');
  const searchInput = document.getElementById('queue-search-input');
  const searchButton = document.getElementById('queue-search-btn');
  const searchContainer = document.getElementById('queue-search');

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

  // --- Van ---
  const vanMaterials = buildVanMaterials();

  const vanDraco = new DRACOLoader().setDecoderPath(
    'https://unpkg.com/three@0.164.1/examples/jsm/libs/draco/',
  );
  new GLTFLoader().setDRACOLoader(vanDraco).load(
    VAN_GLB_PATH,
    (gltf) => {
      const van = gltf.scene;
      applyVanMaterials(van, vanMaterials);

      const nativeSize = meshBoundsAtIdentity(van);
      const scaleFactor = uniformFitScale(nativeSize, VAN_TARGET_DIMS);
      vanPivot = centerPivot(van, scaleFactor);
      blenderRoot.add(vanPivot);
      applyTransforms();

      console.log('[van-can] van GLB loaded', {
        nativeSize: [nativeSize.x, nativeSize.y, nativeSize.z],
        scaleFactor,
        finalSize: [nativeSize.x * scaleFactor, nativeSize.y * scaleFactor, nativeSize.z * scaleFactor],
      });
      window.__van = van;
      window.__vanPivot = vanPivot;
    },
    (xhr) => {
      if (xhr.lengthComputable) {
        console.log(`[van-can] van GLB ${(xhr.loaded / xhr.total * 100).toFixed(0)}%`);
      }
    },
    (err) => console.error('[van-can] van GLB failed to load:', err),
  );

  // --- Can (loaded via shared loadCan: PBR material + decal canvas pipeline) ---
  // loadCan internally normalizes the can so its longest axis is 3 units and
  // bbox is centered at origin. Convert that frame to Blender meters with a
  // single static factor so the existing can layout values still apply.
  const CAN_PIVOT_SCALE = Math.max(...CAN_TARGET_DIMS) / 3;

  // Positioning helper for the queue UI controls — declared here so the resize
  // handler below can reference it before the can finishes loading.
  let positionPauseButton = () => {};

  const labelBuild = createLabelBuild(await loadLabelAssets());

  loadCan({
    modelPath: CAN_FBX_PATH,
    texturePath: CAN_TEXTURE_PATH,
    labelBuild,
    onLoaded({ canGroup, material, setArtworkEntry, height }) {
      material.envMapIntensity = ENV_MAP_INTENSITY;

      canPivot = centerPivot(canGroup, CAN_PIVOT_SCALE);
      blenderRoot.add(canPivot);
      applyTransforms();
      window.__canGroup = canGroup;
      window.__canPivot = canPivot;

      const loadingEl = document.getElementById('loading');
      if (loadingEl) loadingEl.classList.add('hidden');

      if (queueUI) queueUI.classList.add('visible');

      // Stretch state — distorts the can vertically per artwork aspect ratio.
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
        setArtworkEntry({
          image: item,
          title: item._item.name,
          author: item._item.username,
          avatarUrl: item._item.avatar,
        }, applyStretchY);
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

      positionPauseButton = function positionPauseButton() {
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
      };

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
    },
  });

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
    positionPauseButton();
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
