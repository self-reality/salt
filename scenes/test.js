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
import { addCanOverlay } from '../lib/can-overlay.js';
import { setupPixelArtPass } from '../lib/post-processing.js';
import { setupPixelArtControls } from '../controls.js';
import { buildRandomManifestFromDataset } from '../lib/dataset.js';
import { deriveColors } from '../lib/color-extraction.js';

// Same dataset the queue scene draws from — the only one carrying the
// localFilename/width/height fields needed to load an artwork from /artworks.
const DATASET_PATH = 'queue/most-expensive-artworks.json';
const ARTWORK_BASE_PATH = 'artworks/';
const ARTWORK_SAMPLE_SIZE = 10;
const HEADER_SVG_PATH = 'elements/Header.svg';

// The Header.svg authored colours, mapped to the derived trio. #574BA6 is used
// twice: the pill rects (background) and the masked outline path — the latter is
// matched first by its `mask=` attribute so the two roles stay distinct.
function recolorHeaderSvg(svg, { background, text, outline }) {
  return svg
    .replace(/fill="#574BA6"(\s+mask="url\([^"]*\)")/gi, `fill="${outline}"$1`)
    .replace(/fill="#574BA6"/gi, `fill="${background}"`)
    .replace(/fill="#F2C335"/gi, `fill="${text}"`);
}

const svgToDataUrl = (svg) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

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

  // Header SVG source, fetched once so we can recolour it per-artwork.
  let headerSvgText = null;
  try {
    headerSvgText = await fetch(HEADER_SVG_PATH).then((r) => r.text());
  } catch (err) {
    console.warn('Could not load Header.svg for recolouring:', err);
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
  // Constant-size overlay decals (e.g. the Header) — re-glued to the surface
  // each frame so they stay put (and the same size) while the can stretches.
  let headerOverlay = null;

  loadCan({
    modelPath: 'bennyrizzo - 1950s-spam/source/Spam can.fbx',
    texturePath: 'bennyrizzo - 1950s-spam/textures/',
    onLoaded({ canGroup, material, setArtwork, setArtworkFromUrl, setBaseTexture, clearArtwork, setLabelBackgroundColor, setOnArtworkImage, width, height, depth }) {
      // Wire up wireframe toggle and environment controls now that material is ready
      setupWireframeToggle(material);
      setupEnvironmentControls(renderer, scene, material);

      configureStretchModel(canGroup, width, height, depth);
      scene.add(canGroup);

      // Header decal, centered on the can back. Authored in 4096px texture space:
      // center-x 2971, top-y 2004, size 764x324  ->  UV center (u, v), flipY=true.
      headerOverlay = addCanOverlay({
        canGroup,
        url: 'elements/Header.svg',
        u: 2971 / 4096,                    // 0.7251
        v: 1 - (2004 + 324 / 2) / 4096,    // 0.4712 (center-y from the top edge)
        wPx: 764,
        hPx: 324,
      });

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

      if (originalToggle) {
        // Remembers the user's edits while previewing the original, so the toggle is non-destructive.
        let savedTexture = null;
        let savedStretch = null;

        const setEditingDisabled = (disabled) => {
          if (textureSelect) textureSelect.disabled = disabled;
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

      // -----------------------------------------------------------------------
      // Label colours: derive a {background, text, outline} trio from the
      // loaded artwork, paint the band background with it, and recolour the
      // header overlay. Manual swatch edits override the derived value until
      // "Re-derive" is clicked.
      // -----------------------------------------------------------------------
      const methodSelect = document.getElementById('color-method');
      const sampleSlider = document.getElementById('color-sample');
      const paletteSlider = document.getElementById('color-palette');
      const saturationSlider = document.getElementById('color-saturation');
      const contrastSlider = document.getElementById('color-contrast');
      const bgInput = document.getElementById('color-bg');
      const textInput = document.getElementById('color-text');
      const outlineInput = document.getElementById('color-outline');
      const autoCheckbox = document.getElementById('color-auto');
      const rederiveBtn = document.getElementById('color-rederive');

      let lastArtwork = null;
      const overrides = {}; // manual swatch edits: { background?, text?, outline? }

      const readSettings = () => ({
        method: methodSelect ? methodSelect.value : 'dominant',
        sampleSize: sampleSlider ? parseInt(sampleSlider.value, 10) : 64,
        paletteSize: paletteSlider ? parseInt(paletteSlider.value, 10) : 8,
        saturation: saturationSlider ? parseFloat(saturationSlider.value) : 1,
        minContrast: contrastSlider ? parseFloat(contrastSlider.value) : 4.5,
      });

      // Derived trio (or current swatch values when no artwork yet), with any
      // manual overrides applied on top.
      const currentTrio = () => {
        const base = lastArtwork
          ? deriveColors(lastArtwork, readSettings())
          : {
              background: bgInput ? bgInput.value : '#000000',
              text: textInput ? textInput.value : '#ffffff',
              outline: outlineInput ? outlineInput.value : '#000000',
            };
        return { ...base, ...overrides };
      };

      const applyCanColors = (trio) => {
        if (setLabelBackgroundColor) setLabelBackgroundColor(trio.background);
        if (headerOverlay && headerSvgText) {
          headerOverlay.setImage(svgToDataUrl(recolorHeaderSvg(headerSvgText, trio)));
        }
        if (bgInput) bgInput.value = trio.background;
        if (textInput) textInput.value = trio.text;
        if (outlineInput) outlineInput.value = trio.outline;
      };

      const apply = () => applyCanColors(currentTrio());

      // Re-derive whenever the artwork changes (if auto is enabled).
      if (setOnArtworkImage) {
        setOnArtworkImage((img) => {
          lastArtwork = img;
          if (!autoCheckbox || autoCheckbox.checked) apply();
        });
      }

      // Method + settings: re-derive live and keep the value displays in sync.
      const bindSlider = (slider, fmt) => {
        if (!slider) return;
        const valueEl = document.getElementById(`${slider.id}-value`);
        const sync = () => { if (valueEl) valueEl.textContent = fmt(slider.value); };
        sync();
        slider.addEventListener('input', () => { sync(); apply(); });
      };
      bindSlider(sampleSlider, (v) => String(parseInt(v, 10)));
      bindSlider(paletteSlider, (v) => String(parseInt(v, 10)));
      bindSlider(saturationSlider, (v) => parseFloat(v).toFixed(2));
      bindSlider(contrastSlider, (v) => parseFloat(v).toFixed(1));
      if (methodSelect) methodSelect.addEventListener('change', apply);

      // Manual swatch edits become overrides until "Re-derive" clears them.
      if (bgInput) bgInput.addEventListener('input', () => { overrides.background = bgInput.value; apply(); });
      if (textInput) textInput.addEventListener('input', () => { overrides.text = textInput.value; apply(); });
      if (outlineInput) outlineInput.addEventListener('input', () => { overrides.outline = outlineInput.value; apply(); });

      if (rederiveBtn) {
        rederiveBtn.addEventListener('click', () => {
          delete overrides.background;
          delete overrides.text;
          delete overrides.outline;
          apply();
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
    if (headerOverlay) headerOverlay.update();
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
