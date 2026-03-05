import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Artwork rectangle on the base color texture (UV space, pixels)
const ARTWORK_X = 122;
const ARTWORK_Y = 501;
const ARTWORK_WIDTH = 317;
const ARTWORK_HEIGHT = 259;

const textureLoader = new THREE.TextureLoader();

/** Loads a texture from basePath+filename with optional colorSpace; flips Y for correct UV orientation. */
function loadTex(basePath, filename, colorSpace) {
  const tex = textureLoader.load(basePath + filename);
  tex.colorSpace = colorSpace || THREE.LinearSRGBColorSpace;
  tex.flipY = true;
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
    decalCtx.drawImage(baseImage, 0, 0);

    decalTexture = new THREE.CanvasTexture(decalCanvas);
    decalTexture.colorSpace = THREE.SRGBColorSpace;
    decalTexture.flipY = true;

    material.map = decalTexture;
    material.needsUpdate = true;

    baseImageReady = true;
    tryOnLoaded();
  };

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
      decalCtx.fillStyle = 'black';
      decalCtx.fillRect(0, 501, 1024, 259);

      decalCtx.clearRect(ARTWORK_X, ARTWORK_Y, ARTWORK_WIDTH, ARTWORK_HEIGHT);
      decalCtx.drawImage(img, 0, 0, img.width, img.height, ARTWORK_X, ARTWORK_Y, ARTWORK_WIDTH, ARTWORK_HEIGHT);

      const stretchY = (ARTWORK_WIDTH * img.height) / (ARTWORK_HEIGHT * img.width);
      if (onAspectRatio) onAspectRatio(stretchY);

      if (decalTexture) decalTexture.needsUpdate = true;

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

    decalCtx.fillStyle = 'black';
    decalCtx.fillRect(0, 501, 1024, 259);

    decalCtx.clearRect(ARTWORK_X, ARTWORK_Y, ARTWORK_WIDTH, ARTWORK_HEIGHT);
    decalCtx.drawImage(img, 0, 0, img.width, img.height, ARTWORK_X, ARTWORK_Y, ARTWORK_WIDTH, ARTWORK_HEIGHT);

    const stretchY = (ARTWORK_WIDTH * img.height) / (ARTWORK_HEIGHT * img.width);
    if (onAspectRatio) onAspectRatio(stretchY);

    if (decalTexture) decalTexture.needsUpdate = true;
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
