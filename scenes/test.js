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
  getStretchValues,
  setStretchValues,
  resetStretch,
} from '../controls.js';
import { loadCan } from '../lib/can.js';
import { setupPixelArtPass } from '../lib/post-processing.js';
import { setupPixelArtControls } from '../controls.js';
import { buildRandomManifestFromDataset } from '../lib/dataset.js';

// Same dataset the queue scene draws from — the only one carrying the
// localFilename/width/height fields needed to load an artwork from /artworks.
const DATASET_PATH = 'queue/most-expensive-artworks.json';
const ARTWORK_BASE_PATH = 'artworks/';
const ARTWORK_SAMPLE_SIZE = 10;

export async function runTestScene() {
  // Pick a handful of random queue artworks to offer in the texture picker.
  // Fetched up-front so the <select> can be populated once the can is ready.
  let artworkSamples = [];
  try {
    const dataset = await fetch(DATASET_PATH).then((r) => r.json());
    artworkSamples = buildRandomManifestFromDataset(dataset, ARTWORK_SAMPLE_SIZE);
  } catch (err) {
    console.warn('Could not load artwork dataset for texture picker:', err);
  }

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
    onLoaded({ canGroup, material, setArtwork, setArtworkFromUrl, setBaseTexture, clearArtwork, width, height, depth }) {
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

      // Texture picker + "Show original" toggle
      const textureSelect = document.getElementById('base-texture');
      const originalToggle = document.getElementById('toggle-original');
      const stretchSliders = [
        document.getElementById('stretch-x'),
        document.getElementById('stretch-y'),
        document.getElementById('stretch-z'),
      ];

      // Offer the random queue artworks alongside the base textures. Selecting
      // one composites it onto the label band and stretches the can to the
      // artwork's aspect ratio — the same resize logic the queue scene applies.
      const artworkByValue = new Map();
      if (textureSelect && artworkSamples.length) {
        const group = document.createElement('optgroup');
        group.label = 'Artworks (queue)';
        artworkSamples.forEach((item, i) => {
          const value = `artwork:${i}`;
          artworkByValue.set(value, item);
          const option = document.createElement('option');
          option.value = value;
          option.textContent = `${item.username} — ${item.name}`;
          group.appendChild(option);
        });
        textureSelect.appendChild(group);
      }

      // Applies a dropdown selection: an artwork composites onto the label and
      // resizes the can; a base texture clears any artwork and restores the
      // can's original (un-stretched) shape before swapping the base color.
      function applySelection(value) {
        const artwork = artworkByValue.get(value);
        if (artwork) {
          setArtworkFromUrl(ARTWORK_BASE_PATH + artwork.filename, setStretchYFromFactor);
        } else {
          clearArtwork();
          resetStretch();
          setBaseTexture(value);
        }
      }

      if (textureSelect) {
        textureSelect.addEventListener('change', () => {
          applySelection(textureSelect.value);
        });
        // Apply the default-selected texture (salt-bitmap) on load
        applySelection(textureSelect.value);
      }

      // Prev/Next arrows step through the texture dropdown (incl. the queue
      // artworks) and apply each selection — same cycling as the label builder.
      function cycleTexture(dir) {
        if (!textureSelect) return;
        const count = textureSelect.options.length;
        if (count <= 1) return;
        let i = textureSelect.selectedIndex + dir;
        if (i < 0) i = count - 1;        // wrap past the first option
        else if (i > count - 1) i = 0;   // wrap past the last
        textureSelect.selectedIndex = i;
        applySelection(textureSelect.value);
      }

      const texturePrev = document.getElementById('texture-prev');
      const textureNext = document.getElementById('texture-next');
      if (texturePrev) texturePrev.addEventListener('click', () => cycleTexture(-1));
      if (textureNext) textureNext.addEventListener('click', () => cycleTexture(1));

      if (originalToggle) {
        // Remembers the user's edits while previewing the original, so the toggle is non-destructive.
        let savedTexture = null;
        let savedStretch = null;

        const setEditingDisabled = (disabled) => {
          if (textureSelect) textureSelect.disabled = disabled;
          if (texturePrev) texturePrev.disabled = disabled;
          if (textureNext) textureNext.disabled = disabled;
          stretchSliders.forEach((slider) => {
            if (slider) slider.disabled = disabled;
          });
        };

        originalToggle.addEventListener('change', () => {
          if (originalToggle.checked) {
            savedTexture = textureSelect ? textureSelect.value : 'BaseColor.png';
            savedStretch = getStretchValues();

            clearArtwork();
            setBaseTexture('BaseColor.png');
            if (textureSelect) textureSelect.value = 'BaseColor.png';
            resetStretch();

            setEditingDisabled(true);
          } else {
            setEditingDisabled(false);

            const texture = savedTexture || 'BaseColor.png';
            applySelection(texture);
            if (textureSelect) textureSelect.value = texture;
            if (savedStretch) setStretchValues(savedStretch.x, savedStretch.y, savedStretch.z);
          }
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
