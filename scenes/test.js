import * as THREE from 'three';
import {
  setupOrbitControls,
  initStretchControls,
  configureStretchModel,
  setupWireframeToggle,
  setupLighting,
  setupEnvironmentMap,
  setupEnvironmentControls,
  setStretchYFromFactor,
} from '../controls.js';
import { loadCan } from '../lib/can.js';
import { setupPixelArtPass } from '../lib/post-processing.js';
import { setupPixelArtControls } from '../controls.js';

export function runTestScene() {
  // ---------------------------------------------------------------------------
  // Renderer
  // ---------------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.01;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  // ---------------------------------------------------------------------------
  // Scene
  // ---------------------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  const axes = new THREE.AxesHelper(1);
  axes.position.set(-2, -2, 2);
  axes.visible = true;
  scene.add(axes);

  // ---------------------------------------------------------------------------
  // Environment map
  // ---------------------------------------------------------------------------
  setupEnvironmentMap(scene, renderer);

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 5);

  // ---------------------------------------------------------------------------
  // Orbit controls + stretch UI
  // ---------------------------------------------------------------------------
  const controls = setupOrbitControls(camera, renderer.domElement, axes);
  initStretchControls();

  // ---------------------------------------------------------------------------
  // Lighting
  // ---------------------------------------------------------------------------
  setupLighting(scene);

  // ---------------------------------------------------------------------------
  // Post-processing
  // ---------------------------------------------------------------------------
  const { composer, pixelArtPass } = setupPixelArtPass(renderer, scene, camera);
  setupPixelArtControls(pixelArtPass);

  // ---------------------------------------------------------------------------
  // Load can
  // ---------------------------------------------------------------------------
  loadCan({
    modelPath: 'bennyrizzo - 1950s-spam/source/Spam can.fbx',
    texturePath: 'bennyrizzo - 1950s-spam/textures/',
    onLoaded({ canGroup, material, setArtwork, width, height, depth }) {
      // Wire up wireframe toggle and environment controls now that material is ready
      setupWireframeToggle(material);
      setupEnvironmentControls(renderer, scene, material);

      configureStretchModel(canGroup, width, height, depth);
      scene.add(canGroup);

      camera.position.set(0, 1, 4.5);
      controls.target.set(0, 0, 0);
      controls.update();

      document.getElementById('loading').classList.add('hidden');

      // Decal file input
      const decalInput = document.getElementById('decal-file');
      if (decalInput) {
        decalInput.addEventListener('change', (event) => {
          const file = event.target.files && event.target.files[0];
          if (file) setArtwork(file, setStretchYFromFactor);
        });
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Controls panel collapse UI
  // ---------------------------------------------------------------------------
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

  const sectionTitles = document.querySelectorAll('.controls-group .controls-section-title');
  sectionTitles.forEach((title) => {
    const group = title.closest('.controls-group');
    if (!group) return;
    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');
    title.setAttribute('aria-expanded', 'true');
    const toggleGroup = () => {
      group.classList.toggle('collapsed');
      title.setAttribute('aria-expanded', (!group.classList.contains('collapsed')).toString());
    };
    title.addEventListener('click', toggleGroup);
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleGroup();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    composer.render();
  }
  animate();

  // ---------------------------------------------------------------------------
  // Resize handler
  // ---------------------------------------------------------------------------
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
