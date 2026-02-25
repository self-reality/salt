import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// -----------------------------------------------------------------------------
// Orbit controls setup (camera + view checkboxes)
// -----------------------------------------------------------------------------
export function setupOrbitControls(camera, domElement, axes) {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 1.5;
  controls.minDistance = 1;
  controls.maxDistance = 20;

  const autoRotateCheckbox = document.getElementById('toggle-autorotate');
  if (autoRotateCheckbox) {
    autoRotateCheckbox.checked = controls.autoRotate;
    autoRotateCheckbox.addEventListener('change', () => {
      controls.autoRotate = autoRotateCheckbox.checked;
    });
  }

  const axesCheckbox = document.getElementById('toggle-axes');
  if (axesCheckbox && axes) {
    axesCheckbox.checked = axes.visible;
    axesCheckbox.addEventListener('change', () => {
      axes.visible = axesCheckbox.checked;
    });
  }

  return controls;
}

// -----------------------------------------------------------------------------
// Lighting controls (three-point lights + intensity sliders)
// -----------------------------------------------------------------------------
export function setupLighting(scene) {
  const ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xd0d0d0, 0.5);
  hemiLight.position.set(0, 10, 0);
  scene.add(hemiLight);

  const dirLight1 = new THREE.DirectionalLight(0xfff5e6, 0.8); // Key (warm, front-right)
  dirLight1.position.set(5, 8, 7);
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0xf0f0ff, 0.5); // Fill (cool, opposite side)
  dirLight2.position.set(-4, 3, -5);
  scene.add(dirLight2);

  const dirLight3 = new THREE.DirectionalLight(0xffffff, 0.3); // Rim / back
  dirLight3.position.set(0, -3, -6);
  scene.add(dirLight3);

  const ambientSlider = document.getElementById('light-ambient-intensity');
  const keySlider = document.getElementById('light-key-intensity');
  const fillSlider = document.getElementById('light-fill-intensity');

  if (ambientSlider) {
    ambientSlider.value = String(ambientLight.intensity);
    ambientSlider.addEventListener('input', () => {
      const value = parseFloat(ambientSlider.value);
      if (!Number.isNaN(value)) {
        ambientLight.intensity = value;
      }
    });
  }

  if (keySlider) {
    keySlider.value = String(dirLight1.intensity);
    keySlider.addEventListener('input', () => {
      const value = parseFloat(keySlider.value);
      if (!Number.isNaN(value)) {
        dirLight1.intensity = value;
      }
    });
  }

  if (fillSlider) {
    fillSlider.value = String(dirLight2.intensity);
    fillSlider.addEventListener('input', () => {
      const value = parseFloat(fillSlider.value);
      if (!Number.isNaN(value)) {
        dirLight2.intensity = value;
        dirLight3.intensity = value;
      }
    });
  }

  return { ambientLight, hemiLight, dirLight1, dirLight2, dirLight3 };
}

// -----------------------------------------------------------------------------
// Environment setup (HDR env map + UI controls)
// -----------------------------------------------------------------------------
export function setupEnvironmentMap(scene, renderer) {
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
}

export function setupEnvironmentControls(renderer, scene, material) {
  if (!renderer || !scene || !material) return;

  const envReflectionSlider = document.getElementById('env-reflection');
  const exposureSlider = document.getElementById('env-exposure');
  const backgroundColorInput = document.getElementById('env-background-color');

  if (envReflectionSlider) {
    const initial =
      typeof material.envMapIntensity === 'number' ? material.envMapIntensity : 1;
    envReflectionSlider.value = String(initial);
    envReflectionSlider.addEventListener('input', () => {
      const value = parseFloat(envReflectionSlider.value);
      if (!Number.isNaN(value)) {
        material.envMapIntensity = value;
      }
    });
  }

  if (exposureSlider) {
    exposureSlider.value = String(renderer.toneMappingExposure);
    exposureSlider.addEventListener('input', () => {
      const value = parseFloat(exposureSlider.value);
      if (!Number.isNaN(value)) {
        renderer.toneMappingExposure = value;
      }
    });
  }

  if (backgroundColorInput && scene.background && scene.background.isColor) {
    const initialHex = `#${scene.background.getHexString()}`;
    backgroundColorInput.value = initialHex;
    backgroundColorInput.addEventListener('input', () => {
      const hex = backgroundColorInput.value;
      scene.background.set(hex);
    });
  }
}

// -----------------------------------------------------------------------------
// Wireframe mode toggle
// -----------------------------------------------------------------------------
export function setupWireframeToggle(material) {
  if (!material) return;

  const wireframeCheckbox = document.getElementById('toggle-wireframe');
  if (!wireframeCheckbox) return;

  wireframeCheckbox.checked = !!material.wireframe;
  wireframeCheckbox.addEventListener('change', () => {
    material.wireframe = wireframeCheckbox.checked;
    material.needsUpdate = true;
  });
}

// -----------------------------------------------------------------------------
// Stretch controls (sliders + number inputs)
// -----------------------------------------------------------------------------
let stretchCanModel = null;
let originalWidth = 1;
let originalHeight = 1;
let originalDepth = 1;

let sliderX = null;
let sliderY = null;
let sliderZ = null;
let inputX = null;
let inputY = null;
let inputZ = null;

function applyStretch(width, height, depth) {
  if (!stretchCanModel) return;

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  stretchCanModel.traverse((child) => {
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

  const deltaX = (width - originalWidth) / 2;
  const deltaY = (height - originalHeight) / 2;
  const deltaZ = (depth - originalDepth) / 2;

  stretchCanModel.traverse((child) => {
    if (!child.isMesh || !child.userData.restPositions) return;
    const rest = child.userData.restPositions;
    const pos = child.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const restX = rest[i * 3];
      const restY = rest[i * 3 + 1];
      const restZ = rest[i * 3 + 2];

      const newX = restX < centerX ? restX - deltaX : restX + deltaX;
      const newY = restY < centerY ? restY - deltaY : restY + deltaY;
      const newZ = restZ < centerZ ? restZ - deltaZ : restZ + deltaZ;

      pos.setXYZ(i, newX, newY, newZ);
    }
    pos.needsUpdate = true;
    child.geometry.computeVertexNormals();
  });
}

function updateStretchFromUI() {
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
  if (!sliderX || !sliderY || !sliderZ || !inputX || !inputY || !inputZ) return;

  const width = clampToInputRange(inputX, parseFloat(inputX.value));
  const height = clampToInputRange(inputY, parseFloat(inputY.value));
  const depth = clampToInputRange(inputZ, parseFloat(inputZ.value));

  sliderX.value = String(width);
  sliderY.value = String(height);
  sliderZ.value = String(depth);

  updateStretchFromUI();
}

export function initStretchControls() {
  sliderX = document.getElementById('stretch-x');
  sliderY = document.getElementById('stretch-y');
  sliderZ = document.getElementById('stretch-z');
  inputX = document.getElementById('stretch-x-input');
  inputY = document.getElementById('stretch-y-input');
  inputZ = document.getElementById('stretch-z-input');

  if (sliderX) sliderX.addEventListener('input', updateStretchFromUI);
  if (sliderY) sliderY.addEventListener('input', updateStretchFromUI);
  if (sliderZ) sliderZ.addEventListener('input', updateStretchFromUI);
  if (inputX) inputX.addEventListener('input', updateStretchFromNumberInputs);
  if (inputY) inputY.addEventListener('input', updateStretchFromNumberInputs);
  if (inputZ) inputZ.addEventListener('input', updateStretchFromNumberInputs);
}

export function configureStretchModel(model, width, height, depth) {
  stretchCanModel = model;
  originalWidth = width;
  originalHeight = height;
  originalDepth = depth;

  const stretchSection = document.getElementById('stretch-section');

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
}

