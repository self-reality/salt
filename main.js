import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import {
  setupOrbitControls,
  initStretchControls,
  configureStretchModel,
  setupWireframeToggle,
  setupLighting,
  setupEnvironmentMap,
  setupEnvironmentControls,
} from './controls.js';

// -----------------------------------------------------------------------------
// Renderer (WebGL, ACES tone mapping, sRGB output)
// -----------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 2.5;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// -----------------------------------------------------------------------------
// Scene (white background, optional debug axes)
// -----------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

// Debug axes: X=red, Y=green, Z=blue (positioned out of the way)
const axes = new THREE.AxesHelper(1);
axes.position.set(-2, -2, 2);
axes.visible = true;
scene.add(axes);

// -----------------------------------------------------------------------------
// Environment map (HDR → PMREM cubemap for PBR reflections on the can)
// -----------------------------------------------------------------------------
setupEnvironmentMap(scene, renderer);

// -----------------------------------------------------------------------------
// Camera (perspective, initial position in front of origin)
// -----------------------------------------------------------------------------
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 0, 5);

// -----------------------------------------------------------------------------
// Orbit controls (drag to rotate, scroll to zoom)
// -----------------------------------------------------------------------------
const controls = setupOrbitControls(camera, renderer.domElement, axes);

// Stretch UI controls (sliders and inputs)
initStretchControls();

// -----------------------------------------------------------------------------
// Lighting (three-point style: key, fill, rim)
// -----------------------------------------------------------------------------
setupLighting(scene);

// -----------------------------------------------------------------------------
// PBR textures for the Spam can material
// -----------------------------------------------------------------------------
const textureLoader = new THREE.TextureLoader();
const basePath = 'bennyrizzo - 1950s-spam/textures/';

/** Loads a texture from the base path with optional color space; flips Y for correct UV orientation. */
function loadTex(filename, colorSpace) {
  const tex = textureLoader.load(basePath + filename);
  tex.colorSpace = colorSpace || THREE.LinearSRGBColorSpace;
  tex.flipY = true;
  return tex;
}

const baseColorMap = loadTex('BaseColor.png', THREE.SRGBColorSpace);
const metallicMap  = loadTex('Metallic_4.png');
const normalMap    = loadTex('Normal.png');
const roughnessMap = loadTex('Roughness.png');

// Offscreen canvas/texture used for compositing a user-provided decal into the base color map.
// Previous artwork rect: X=167, Y=504, W=227, H=256
const ARTWORK_X = 122;
const ARTWORK_Y = 501;
const ARTWORK_WIDTH = 317;
const ARTWORK_HEIGHT = 259;

let decalCanvas = null;
let decalCtx = null;
let decalTexture = null;

// -----------------------------------------------------------------------------
// Can material (MeshStandardMaterial with baseColor, metallic, roughness, normal)
// -----------------------------------------------------------------------------
const goldMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  map: baseColorMap,
  metalnessMap: metallicMap,
  metalness: 1.0,
  roughnessMap: roughnessMap,
  roughness: 1.0,
  normalMap: normalMap,
  envMapIntensity: 1,
});

// Wireframe toggle checkbox (delegated to controls.js).
setupWireframeToggle(goldMaterial);

// Environment / renderer UI bindings
setupEnvironmentControls(renderer, scene, goldMaterial);

// Initialize the decal canvas once the base color image has loaded.
// We draw the original texture into an offscreen canvas and create a CanvasTexture from it.
const baseImage = new Image();
baseImage.src = basePath + 'BaseColor.png';
baseImage.onload = () => {
  decalCanvas = document.createElement('canvas');
  decalCanvas.width = baseImage.width;
  decalCanvas.height = baseImage.height;
  decalCtx = decalCanvas.getContext('2d');

  // Start with the original base color texture.
  decalCtx.drawImage(baseImage, 0, 0);

  decalTexture = new THREE.CanvasTexture(decalCanvas);
  decalTexture.colorSpace = THREE.SRGBColorSpace;
  decalTexture.flipY = true;

  goldMaterial.map = decalTexture;
  goldMaterial.needsUpdate = true;
};

// -----------------------------------------------------------------------------
// Stretch (X/Y/Z) — vertex scaling in model space from rest positions (set after FBX load)
// -----------------------------------------------------------------------------
// (Stretch implementation now lives in controls.js)

// -----------------------------------------------------------------------------
// Decal image upload handling (draw user image into artwork rectangle on canvas)
// -----------------------------------------------------------------------------
function handleDecalFileChange(event) {
  if (!decalCtx || !decalCanvas) return;

  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    // Draw a black rectangle underneath the uploaded image.
    // Coordinates: start (0, 501), size (1024, 259).
    decalCtx.fillStyle = 'black';
    decalCtx.fillRect(0, 501, 1024, 259);

    // Clear the artwork area and draw the user image stretched to exactly fill it (no cropping).
    decalCtx.clearRect(ARTWORK_X, ARTWORK_Y, ARTWORK_WIDTH, ARTWORK_HEIGHT);
    decalCtx.drawImage(
      img,
      0,
      0,
      img.width,
      img.height,
      ARTWORK_X,
      ARTWORK_Y,
      ARTWORK_WIDTH,
      ARTWORK_HEIGHT
    );



    if (decalTexture) {
      decalTexture.needsUpdate = true;
    }

    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

const decalInput = document.getElementById('decal-file');
if (decalInput) {
  decalInput.addEventListener('change', handleDecalFileChange);
}

// -----------------------------------------------------------------------------
// UI: Controls panel collapse toggle + wireframe mode
// -----------------------------------------------------------------------------
const controlsPanel = document.getElementById('controls-panel');
const panelToggleButton = document.getElementById('toggle-controls-panel');
if (controlsPanel && panelToggleButton) {
  const updatePanelToggleLabel = () => {
    const isCollapsed = controlsPanel.classList.contains('collapsed');
    panelToggleButton.textContent = isCollapsed ? 'Show controls' : 'Hide controls';
    panelToggleButton.setAttribute('aria-expanded', (!isCollapsed).toString());
  };

  panelToggleButton.addEventListener('click', () => {
    controlsPanel.classList.toggle('collapsed');
    updatePanelToggleLabel();
  });

  updatePanelToggleLabel();
}

// Per-section collapse/expand for controls groups.
const sectionTitles = document.querySelectorAll('.controls-group .controls-section-title');
sectionTitles.forEach((title) => {
  const group = title.closest('.controls-group');
  if (!group) return;

  title.setAttribute('role', 'button');
  title.setAttribute('tabindex', '0');
  title.setAttribute('aria-expanded', 'true');

  const toggleGroup = () => {
    group.classList.toggle('collapsed');
    const isCollapsed = group.classList.contains('collapsed');
    title.setAttribute('aria-expanded', (!isCollapsed).toString());
  };

  title.addEventListener('click', toggleGroup);
  title.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleGroup();
    }
  });
});

// -----------------------------------------------------------------------------
// FBX model load (apply material, scale/center, flatten hierarchy, wire stretch UI)
// -----------------------------------------------------------------------------
const fbxLoader = new FBXLoader();

fbxLoader.load(
  'bennyrizzo - 1950s-spam/source/Spam can.fbx',
  (fbx) => {
    fbx.traverse((child) => {
      if (child.isMesh) child.material = goldMaterial;
    });

    // Scale to a consistent size, then center at origin
    const box = new THREE.Box3().setFromObject(fbx);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const desiredSize = 3;
    const scale = desiredSize / maxDim;
    fbx.scale.setScalar(scale);

    const box2 = new THREE.Box3().setFromObject(fbx);
    const center = box2.getCenter(new THREE.Vector3());
    fbx.position.sub(center);

    // Flatten hierarchy: bake world positions into each mesh's geometry,
    // store a copy as restPositions for stretch, then reset all transforms to identity.
    fbx.updateMatrixWorld(true);
    fbx.traverse((child) => {
      if (!child.isMesh) return;
      const pos = child.geometry.attributes.position;
      const worldPos = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        worldPos.set(x, y, z).applyMatrix4(child.matrixWorld);
        pos.setXYZ(i, worldPos.x, worldPos.y, worldPos.z);
      }
      pos.needsUpdate = true;
      child.geometry.computeVertexNormals();
      child.userData.restPositions = pos.array.slice(0);
    });
    fbx.traverse((child) => {
      child.position.set(0, 0, 0);
      child.quaternion.identity();
      child.scale.setScalar(1);
    });
    fbx.scale.setScalar(1);
    fbx.position.set(0, 0, 0);
    fbx.updateMatrixWorld(true);

    const box3 = new THREE.Box3().setFromObject(fbx);
    const size3 = box3.getSize(new THREE.Vector3());
    configureStretchModel(fbx, size3.x, size3.y, size3.z);

    scene.add(fbx);

    camera.position.set(0, 1, 4.5);
    controls.target.set(0, 0, 0);
    controls.update();

    document.getElementById('loading').classList.add('hidden');
  },
  (progress) => {
  },
  (error) => {
    console.error('Error loading FBX:', error);
    document.getElementById('loading').textContent = 'Failed to load model.';
  }
);

// -----------------------------------------------------------------------------
// Render loop (requestAnimationFrame + orbit controls update)
// -----------------------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// -----------------------------------------------------------------------------
// Window resize (update camera aspect and renderer size)
// -----------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
