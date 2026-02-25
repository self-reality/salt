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

