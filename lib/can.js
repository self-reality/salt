import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Reference texture size the coordinates below are authored against. The decal
// canvas matches whatever the base image's native size is, so if higher-res base
// textures are supplied every coordinate is scaled by canvas.width / TEXTURE_REF_SIZE.
const TEXTURE_REF_SIZE = 1024;

// Artwork rectangle on the base color texture (in TEXTURE_REF_SIZE pixel space)
const ARTWORK_X = 122;
const ARTWORK_Y = 501;
const ARTWORK_WIDTH = 317;
const ARTWORK_HEIGHT = 259;

// Full-width label band that the artwork sits inside (in TEXTURE_REF_SIZE pixel space)
const LABEL_BAND_Y = 501;
const LABEL_BAND_HEIGHT = 259;

// Header rectangle, authored directly in the native 4096px texture space the
// artwork was placed against: centered on x 2971 (the can back), top at y 2004,
// 764x324. Drawn 1:1 into the decal canvas (scaled if the canvas isn't 4096),
// so it deforms with the can exactly like the rest of the printed label.
const HEADER_TEX_SIZE = 4096;
const HEADER_CENTER_X = 2971;
const HEADER_TOP_Y = 2004;
const HEADER_WIDTH = 764;
const HEADER_HEIGHT = 324;

const textureLoader = new THREE.TextureLoader();

// Anisotropic filtering level. Three.js clamps this to the GPU's actual maximum,
// so 16 simply means "use the sharpest filtering this hardware supports". Without
// it, textures on the can's curved/angled surfaces fall back to blurry mipmaps.
const MAX_ANISOTROPY = 16;

/** Loads a texture from basePath+filename with optional colorSpace; flips Y for correct UV orientation. */
function loadTex(basePath, filename, colorSpace) {
  const tex = textureLoader.load(basePath + filename);
  tex.colorSpace = colorSpace || THREE.LinearSRGBColorSpace;
  tex.flipY = true;
  tex.anisotropy = MAX_ANISOTROPY;
  return tex;
}

/**
 * Loads the spam can model and sets up PBR material + decal canvas.
 *
 * @param {object} opts
 * @param {string} opts.modelPath   - Path to the FBX file
 * @param {string} opts.texturePath - Base path for PBR textures (with trailing slash)
 * @param {function} opts.onLoaded  - Called with { canGroup, material, setArtwork, width, height, depth }
 */
export function loadCan({ modelPath, texturePath, onLoaded }) {
  // PBR textures
  const baseColorMap = loadTex(texturePath, 'BaseColor.png', THREE.SRGBColorSpace);
  const metallicMap  = loadTex(texturePath, 'Metallic_4.png');
  const normalMap    = loadTex(texturePath, 'Normal.png');
  const roughnessMap = loadTex(texturePath, 'Roughness.png');

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: baseColorMap,
    metalnessMap: metallicMap,
    metalness: 1.0,
    roughnessMap: roughnessMap,
    roughness: 1.0,
    normalMap: normalMap,
    envMapIntensity: 1.19,
  });

  // Offscreen decal canvas state
  let decalCanvas = null;
  let decalCtx = null;
  let decalTexture = null;
  let fbxReady = false;
  let baseImageReady = false;
  let pendingFbx = null;

  // Swappable base texture state
  let currentBaseImage = null;     // the base color image currently drawn under the artwork
  let lastArtworkImg = null;       // most recent composited artwork, re-applied when re-basing
  const baseImageCache = {};       // filename -> HTMLImageElement

  // Colour the label band gets painted behind the artwork (was hard-coded black).
  // Derived per-artwork in the test scene; defaults to black for other scenes.
  let labelBackgroundColor = 'black';
  // Optional listener fired with the HTMLImageElement whenever the artwork changes.
  let onArtworkImage = null;
  // Header graphic baked onto the label. Null until a scene calls setHeaderImage,
  // so it only appears where it's wanted (currently the test scene).
  let headerImg = null;

  function tryOnLoaded() {
    if (!fbxReady || !baseImageReady) return;

    const fbx = pendingFbx;
    const box = new THREE.Box3().setFromObject(fbx);
    const size = box.getSize(new THREE.Vector3());
    onLoaded({
      canGroup: fbx,
      material,
      setArtwork,
      setArtworkFromUrl,
      setArtworkFromImage,
      setBaseTexture,
      clearArtwork,
      setLabelBackgroundColor,
      setOnArtworkImage,
      setHeaderImage,
      width: size.x,
      height: size.y,
      depth: size.z,
    });
  }

  // Load base image into offscreen canvas
  const baseImage = new Image();
  baseImage.src = texturePath + 'BaseColor.png';
  baseImage.onload = () => {
    decalCanvas = document.createElement('canvas');
    decalCanvas.width = baseImage.width;
    decalCanvas.height = baseImage.height;
    decalCtx = decalCanvas.getContext('2d');
    decalCtx.imageSmoothingQuality = 'high';
    decalCtx.drawImage(baseImage, 0, 0);

    currentBaseImage = baseImage;
    baseImageCache['BaseColor.png'] = baseImage;

    decalTexture = new THREE.CanvasTexture(decalCanvas);
    decalTexture.colorSpace = THREE.SRGBColorSpace;
    decalTexture.flipY = true;
    decalTexture.anisotropy = MAX_ANISOTROPY;

    material.map = decalTexture;
    material.needsUpdate = true;

    baseImageReady = true;
    tryOnLoaded();
  };

  /** Draws the artwork onto the label band of the decal canvas (no texture update). */
  function compositeArtwork(img) {
    // Scale the authored (1024-space) coordinates to the canvas's actual resolution.
    const s = decalCanvas.width / TEXTURE_REF_SIZE;

    decalCtx.fillStyle = labelBackgroundColor;
    decalCtx.fillRect(0, LABEL_BAND_Y * s, decalCanvas.width, LABEL_BAND_HEIGHT * s);

    decalCtx.clearRect(ARTWORK_X * s, ARTWORK_Y * s, ARTWORK_WIDTH * s, ARTWORK_HEIGHT * s);
    decalCtx.drawImage(
      img, 0, 0, img.width, img.height,
      ARTWORK_X * s, ARTWORK_Y * s, ARTWORK_WIDTH * s, ARTWORK_HEIGHT * s,
    );
  }

  /** Draws the header graphic onto its rectangle on the decal canvas (no texture update). */
  function compositeHeader() {
    if (!headerImg || !decalCtx || !decalCanvas) return;
    // Header coords are authored in 4096px space; scale to the canvas's actual size.
    const s = decalCanvas.width / HEADER_TEX_SIZE;
    decalCtx.drawImage(
      headerImg, 0, 0, headerImg.width, headerImg.height,
      (HEADER_CENTER_X - HEADER_WIDTH / 2) * s, HEADER_TOP_Y * s,
      HEADER_WIDTH * s, HEADER_HEIGHT * s,
    );
  }

  /** Redraws the decal canvas from the current base image, re-applying any artwork + header on top. */
  function redrawCanvasFromBase() {
    if (!decalCtx || !decalCanvas || !currentBaseImage) return;
    decalCtx.clearRect(0, 0, decalCanvas.width, decalCanvas.height);
    decalCtx.drawImage(currentBaseImage, 0, 0, decalCanvas.width, decalCanvas.height);
    if (lastArtworkImg) compositeArtwork(lastArtworkImg);
    compositeHeader();
    if (decalTexture) decalTexture.needsUpdate = true;
  }

  /** Sets (or replaces) the header graphic from a URL/data-URL and redraws. */
  function setHeaderImage(src) {
    const img = new Image();
    img.onload = () => {
      headerImg = img;
      redrawCanvasFromBase();
    };
    img.onerror = () => console.error('Failed to load header image:', src);
    img.src = src;
  }

  /** Removes any composited artwork so the label band shows the plain base texture again. */
  function clearArtwork() {
    lastArtworkImg = null;
    redrawCanvasFromBase();
  }

  /** Sets the colour painted behind the artwork on the label band and redraws. */
  function setLabelBackgroundColor(color) {
    labelBackgroundColor = color || 'black';
    redrawCanvasFromBase();
  }

  /** Registers a listener invoked with the artwork image whenever it changes. */
  function setOnArtworkImage(cb) {
    onArtworkImage = cb;
  }

  /** Swaps the underlying base color texture (e.g. 'BaseColor.png' or 'salt-bitmap.png'). */
  function setBaseTexture(filename) {
    const cached = baseImageCache[filename];
    if (cached) {
      currentBaseImage = cached;
      redrawCanvasFromBase();
      return;
    }
    const img = new Image();
    img.onload = () => {
      baseImageCache[filename] = img;
      currentBaseImage = img;
      redrawCanvasFromBase();
    };
    img.onerror = () => console.error('Failed to load base texture:', filename);
    img.src = texturePath + filename;
  }

  /**
   * Composites a user-supplied File onto the can label.
   * @param {File} file
   * @param {function} onAspectRatio - called with stretchY factor
   */
  function setArtwork(file, onAspectRatio) {
    if (!decalCtx || !decalCanvas) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setArtworkFromImage(img, onAspectRatio);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  /**
   * Composites an image from a URL onto the can label.
   * @param {string} url
   * @param {function} onAspectRatio - called with stretchY factor
   */
  function setArtworkFromUrl(url, onAspectRatio) {
    if (!decalCtx || !decalCanvas) return;

    const img = new Image();
    img.onload = () => {
      setArtworkFromImage(img, onAspectRatio);
    };
    img.onerror = () => console.error('Failed to load artwork:', url);
    img.src = url;
  }

  function setArtworkFromImage(img, onAspectRatio) {
    if (!decalCtx || !decalCanvas) return;

    lastArtworkImg = img;
    compositeArtwork(img);
    compositeHeader();

    const stretchY = (ARTWORK_WIDTH * img.height) / (ARTWORK_HEIGHT * img.width);
    if (onAspectRatio) onAspectRatio(stretchY);

    if (decalTexture) decalTexture.needsUpdate = true;
    if (onArtworkImage) onArtworkImage(img);
  }

  // Load FBX
  const fbxLoader = new FBXLoader();
  fbxLoader.load(
    modelPath,
    (fbx) => {
      fbx.traverse((child) => {
        if (child.isMesh) child.material = material;
      });

      // Scale to consistent size, center at origin
      const box = new THREE.Box3().setFromObject(fbx);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 3 / maxDim;
      fbx.scale.setScalar(scale);

      const box2 = new THREE.Box3().setFromObject(fbx);
      const center = box2.getCenter(new THREE.Vector3());
      fbx.position.sub(center);

      // Flatten hierarchy: bake world transforms into geometry, store restPositions
      fbx.updateMatrixWorld(true);
      fbx.traverse((child) => {
        if (!child.isMesh) return;
        const pos = child.geometry.attributes.position;
        const worldPos = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          worldPos.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(child.matrixWorld);
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

      pendingFbx = fbx;
      fbxReady = true;
      tryOnLoaded();
    },
    undefined,
    (error) => {
      console.error('Error loading FBX:', error);
      const loadingEl = document.getElementById('loading');
      if (loadingEl) loadingEl.textContent = 'Failed to load model.';
    }
  );
}
