import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

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
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();
new RGBELoader().load(
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r164/examples/textures/equirectangular/venice_sunset_1k.hdr',
  (hdrEquirect) => {
    const envMap = pmremGenerator.fromEquirectangular(hdrEquirect).texture;
    scene.environment = envMap;
    hdrEquirect.dispose();
    pmremGenerator.dispose();
  }
);

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
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotate = false;
controls.autoRotateSpeed = 1.5;
controls.minDistance = 1;
controls.maxDistance = 20;

// Hook up UI toggles for auto-rotate and axes helper visibility.
const autoRotateCheckbox = document.getElementById('toggle-autorotate');
if (autoRotateCheckbox) {
  autoRotateCheckbox.checked = controls.autoRotate;
  autoRotateCheckbox.addEventListener('change', () => {
    controls.autoRotate = autoRotateCheckbox.checked;
  });
}

const axesCheckbox = document.getElementById('toggle-axes');
if (axesCheckbox) {
  axesCheckbox.checked = axes.visible;
  axesCheckbox.addEventListener('change', () => {
    axes.visible = axesCheckbox.checked;
  });
}

// -----------------------------------------------------------------------------
// Lighting (three-point style: key, fill, rim)
// -----------------------------------------------------------------------------
const ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0xd0d0d0, 0.5);
hemiLight.position.set(0, 10, 0);
scene.add(hemiLight);

const dirLight1 = new THREE.DirectionalLight(0xfff5e6, 0.8);  // Key (warm, front-right)
dirLight1.position.set(5, 8, 7);
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0xf0f0ff, 0.5);  // Fill (cool, opposite side)
dirLight2.position.set(-4, 3, -5);
scene.add(dirLight2);

const dirLight3 = new THREE.DirectionalLight(0xffffff, 0.3);  // Rim / back
dirLight3.position.set(0, -3, -6);
scene.add(dirLight3);

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

const baseColorMap = loadTex('Spam_can_can_BaseColor.png', THREE.SRGBColorSpace);
const metallicMap  = loadTex('Spam_can_can_Metallic_4.png');
const normalMap    = loadTex('Spam_can_can_Normal.png');
const roughnessMap = loadTex('Spam_can_can_Roughness.png');

// Offscreen canvas/texture used for compositing a user-provided decal into the base color map.
// Previous artwork rect: X=167, Y=504, W=227, H=256
const ARTWORK_X = 139;
const ARTWORK_Y = 516;
const ARTWORK_WIDTH = 283;
const ARTWORK_HEIGHT = 230;

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

// Initialize the decal canvas once the base color image has loaded.
// We draw the original texture into an offscreen canvas and create a CanvasTexture from it.
const baseImage = new Image();
baseImage.src = basePath + 'Spam_can_can_BaseColor.png';
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
let canModel = null;
let originalWidth = 1;
let originalHeight = 1;
let originalDepth = 1;

/** Split the can mesh(es) in half along X, Y and Z axes and move halves apart to achieve desired dimensions. Uses restPositions in userData. */
function applyStretch(width, height, depth) {
  if (!canModel) return;
  
  // Calculate bounding box center from all rest positions
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  
  canModel.traverse((child) => {
    if (!child.isMesh || !child.userData.restPositions) return;
    const rest = child.userData.restPositions;
    for (let i = 0; i < rest.length; i += 3) {
      const restX = rest[i];
      const restY = rest[i + 1];
      const restZ = rest[i + 2];
      minX = Math.min(minX, restX);
      maxX = Math.max(maxX, restX);
      minY = Math.min(minY, restY);
      maxY = Math.max(maxY, restY);
      minZ = Math.min(minZ, restZ);
      maxZ = Math.max(maxZ, restZ);
    }
  });
  
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  
  // Calculate how much each half needs to move
  const deltaX = (width - originalWidth) / 2;
  const deltaY = (height - originalHeight) / 2;
  const deltaZ = (depth - originalDepth) / 2;
  
  canModel.traverse((child) => {
    if (!child.isMesh || !child.userData.restPositions) return;
    const rest = child.userData.restPositions;
    const pos = child.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const restX = rest[i * 3];
      const restY = rest[i * 3 + 1];
      const restZ = rest[i * 3 + 2];
      
      // Split X-axis: move left half left, right half right
      const newX = restX < centerX ? restX - deltaX : restX + deltaX;
      
      // Split Y-axis: move bottom half down, top half up
      const newY = restY < centerY ? restY - deltaY : restY + deltaY;
      
      // Split Z-axis: move back half back, front half forward
      const newZ = restZ < centerZ ? restZ - deltaZ : restZ + deltaZ;
      
      pos.setXYZ(i, newX, newY, newZ);
    }
    pos.needsUpdate = true;
    child.geometry.computeVertexNormals();
  });
}

function updateStretchFromUI() {
  const sliderX = document.getElementById('stretch-x');
  const sliderY = document.getElementById('stretch-y');
  const sliderZ = document.getElementById('stretch-z');
  const inputX = document.getElementById('stretch-x-input');
  const inputY = document.getElementById('stretch-y-input');
  const inputZ = document.getElementById('stretch-z-input');

  if (!sliderX || !sliderY || !sliderZ) return;

  const width = parseFloat(sliderX.value);
  const height = parseFloat(sliderY.value);
  const depth = parseFloat(sliderZ.value);

  if (inputX) inputX.value = width.toFixed(2);
  if (inputY) inputY.value = height.toFixed(2);
  if (inputZ) inputZ.value = depth.toFixed(2);

  applyStretch(width, height, depth);
}

function clampToInputRange(input, value) {
  if (!input) return value;
  let v = value;
  if (Number.isNaN(v)) v = parseFloat(input.value) || 0;
  const hasMin = input.min !== '';
  const hasMax = input.max !== '';
  if (hasMin) v = Math.max(v, parseFloat(input.min));
  if (hasMax) v = Math.min(v, parseFloat(input.max));
  input.value = v.toFixed(2);
  return v;
}

function updateStretchFromNumberInputs() {
  const sliderX = document.getElementById('stretch-x');
  const sliderY = document.getElementById('stretch-y');
  const sliderZ = document.getElementById('stretch-z');
  const inputX = document.getElementById('stretch-x-input');
  const inputY = document.getElementById('stretch-y-input');
  const inputZ = document.getElementById('stretch-z-input');

  if (!sliderX || !sliderY || !sliderZ || !inputX || !inputY || !inputZ) return;

  const width = clampToInputRange(inputX, parseFloat(inputX.value));
  const height = clampToInputRange(inputY, parseFloat(inputY.value));
  const depth = clampToInputRange(inputZ, parseFloat(inputZ.value));

  sliderX.value = String(width);
  sliderY.value = String(height);
  sliderZ.value = String(depth);

  updateStretchFromUI();
}

document.getElementById('stretch-x')?.addEventListener('input', updateStretchFromUI);
document.getElementById('stretch-y')?.addEventListener('input', updateStretchFromUI);
document.getElementById('stretch-z')?.addEventListener('input', updateStretchFromUI);
document.getElementById('stretch-x-input')?.addEventListener('input', updateStretchFromNumberInputs);
document.getElementById('stretch-y-input')?.addEventListener('input', updateStretchFromNumberInputs);
document.getElementById('stretch-z-input')?.addEventListener('input', updateStretchFromNumberInputs);

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

// Allow downloading the current composited base color texture as a PNG.
const downloadButton = document.getElementById('download-texture');
if (downloadButton) {
  downloadButton.addEventListener('click', () => {
    if (!decalCanvas) return;
    const link = document.createElement('a');
    link.href = decalCanvas.toDataURL('image/png');
    link.download = 'Spam_can_can_BaseColor_custom.png';
    link.click();
  });
}

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
    canModel = fbx;
    originalWidth = size3.x;
    originalHeight = size3.y;
    originalDepth = size3.z;

    scene.add(fbx);

    // Show stretch section and sync inputs to loaded dimensions (0.5×–3× range)
    const stretchSection = document.getElementById('stretch-section');
    const sliderX = document.getElementById('stretch-x');
    const sliderY = document.getElementById('stretch-y');
    const sliderZ = document.getElementById('stretch-z');
    const inputX = document.getElementById('stretch-x-input');
    const inputY = document.getElementById('stretch-y-input');
    const inputZ = document.getElementById('stretch-z-input');

    if (sliderX && sliderY && sliderZ) {
      sliderX.value = String(originalWidth);
      sliderY.value = String(originalHeight);
      sliderZ.value = String(originalDepth);

      sliderX.min = (0.5 * originalWidth).toFixed(2);
      sliderX.max = (3 * originalWidth).toFixed(2);
      sliderY.min = (0.5 * originalHeight).toFixed(2);
      sliderY.max = (3 * originalHeight).toFixed(2);
      sliderZ.min = (0.5 * originalDepth).toFixed(2);
      sliderZ.max = (3 * originalDepth).toFixed(2);
    }

    if (inputX && inputY && inputZ && sliderX && sliderY && sliderZ) {
      inputX.min = sliderX.min;
      inputX.max = sliderX.max;
      inputY.min = sliderY.min;
      inputY.max = sliderY.max;
      inputZ.min = sliderZ.min;
      inputZ.max = sliderZ.max;

      inputX.step = sliderX.step || '0.01';
      inputY.step = sliderY.step || '0.01';
      inputZ.step = sliderZ.step || '0.01';

      inputX.value = originalWidth.toFixed(2);
      inputY.value = originalHeight.toFixed(2);
      inputZ.value = originalDepth.toFixed(2);
    }

    if (stretchSection) {
      stretchSection.classList.remove('hidden');
    }

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
