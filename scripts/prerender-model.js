// -----------------------------------------------------------------------------
// prerender-model.js — browser-side 3D model exporter for the prerenderer.
//
// Lazily imported by scripts/prerender-page.js only when a model output is
// requested. Reuses lib/can.js's loadCan() (FBX load, hierarchy flatten,
// restPositions, scale-to-3, PBR material, composited decal CanvasTexture,
// setArtworkEntry) so the exported geometry + textures match the live scenes
// exactly, replicates the scenes' per-artwork Y vertex deform, and exports a
// binary GLB via three's GLTFExporter (three.js has no FBX exporter).
// -----------------------------------------------------------------------------

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { loadCan } from '/lib/can.js';

const MODEL_PATH = 'bennyrizzo - 1950s-spam/source/Spam can.fbx';
const TEXTURE_PATH = 'bennyrizzo - 1950s-spam/textures/';

let state = null; // { canGroup, material, setArtworkEntry, originalHeight }

/** Resolves once cb() returns truthy, polling per animation frame up to timeoutMs. */
function waitUntil(cb, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const tick = () => {
      let ok = false;
      try { ok = cb(); } catch (_) { ok = false; }
      if (ok) return resolve();
      if (performance.now() - t0 > timeoutMs) return reject(new Error('waitUntil timeout'));
      requestAnimationFrame(tick);
    };
    tick();
  });
}

/**
 * One-time can load. Drives loadCan with the page's shared labelBuild so
 * setArtworkEntry updates the band/decal the page already exports, and resolves
 * once geometry + all PBR maps have decoded (loadCan doesn't await the three
 * extra TextureLoader maps).
 */
export async function initCanModel(labelBuild) {
  if (state) return;
  const loaded = await new Promise((resolve, reject) => {
    try {
      loadCan({
        modelPath: MODEL_PATH,
        texturePath: TEXTURE_PATH,
        labelBuild,
        onLoaded: resolve,
      });
    } catch (err) {
      reject(err);
    }
  });
  const { canGroup, material, setArtworkEntry, height } = loaded;
  // map (decal) is a CanvasTexture (image ready); wait for the raster PBR maps.
  await waitUntil(() =>
    material.metalnessMap && material.metalnessMap.image
    && material.normalMap && material.normalMap.image
    && material.roughnessMap && material.roughnessMap.image,
  );
  state = { canGroup, material, setArtworkEntry, originalHeight: height };
}

/**
 * Per-artwork Y vertex deform — mirrors scenes/queue-1.js applyStretchY. Reads
 * restPositions each call (idempotent), pushing vertices away from the rest
 * centre so the can elongates by `stretchFactor` about its middle.
 */
function applyStretchY(stretchFactor) {
  if (!Number.isFinite(stretchFactor) || stretchFactor <= 0) return;
  const { canGroup, originalHeight } = state;
  const targetHeight = originalHeight * stretchFactor;
  const deltaY = (targetHeight - originalHeight) / 2;

  let minY = Infinity; let maxY = -Infinity;
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
    for (let i = 0; i < pos.count; i += 1) {
      const restY = rest[i * 3 + 1];
      const newY = restY < centerY ? restY - deltaY : restY + deltaY;
      pos.setXYZ(i, rest[i * 3], newY, rest[i * 3 + 2]);
    }
    pos.needsUpdate = true;
    child.geometry.computeVertexNormals();
  });
}

/** Composites the artwork's label/decal and deforms the geometry for it. */
export function renderModelFor(entry) {
  state.setArtworkEntry(entry, applyStretchY);
}

// GLTFExporter has no flipY support and GLTFLoader assumes flipY=false; can.js
// uses flipY=true. Bake the flip by drawing the source onto a vertically-mirrored
// canvas with flipY=false so the GLB renders upright in standard glTF viewers.
function flipImageToCanvas(img) {
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.translate(0, h);
  ctx.scale(1, -1);
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

function flipImageToTexture(img, colorSpace, mimeType) {
  const tex = new THREE.CanvasTexture(flipImageToCanvas(img));
  tex.colorSpace = colorSpace;
  tex.flipY = false;
  // GLTFExporter reads userData.mimeType to pick the embedded encoding
  // (default image/png).
  if (mimeType) tex.userData.mimeType = mimeType;
  tex.needsUpdate = true;
  return tex;
}
const flippedTexture = (src) => flipImageToTexture(src.image, src.colorSpace);

function abToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000; // 32k — keep String.fromCharCode arg count safe
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parseGlb(group) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      group,
      (result) => resolve(abToBase64(result)),
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      { binary: true },
    );
  });
}

/** Temporarily swaps every mesh's material to `mat`, runs the export, restores. */
async function exportWith(mat) {
  const { canGroup } = state;
  const saved = [];
  canGroup.traverse((child) => {
    if (!child.isMesh) return;
    saved.push([child, child.material]);
    child.material = mat;
  });
  try {
    return await parseGlb(canGroup);
  } finally {
    saved.forEach(([child, m]) => { child.material = m; });
  }
}

/**
 * Exports the current (already-deformed) canGroup as a base64 binary GLB.
 * - textured: a material whose BaseColor is the page's freshly composited
 *   full-can canvas plus the can's Metallic/Normal/Roughness maps, all
 *   flip-normalized. Decoupled from loadCan's internal decal (which the page's
 *   settle detector starves by owning onDraw). baseColorCanvas is required.
 *   - stripSharedMaps: omit the Metallic/Normal/Roughness maps (identical
 *     across every can — export them once via exportSharedMaps() instead and
 *     reattach at runtime). Scalar metalness/roughness factors stay.
 *   - baseColorMime: embedded encoding for the base-color map ('image/jpeg'
 *     shrinks it ~3-5x vs the PNG default; the artwork is opaque, alpha-free).
 * - bare: a plain material, geometry only.
 */
export async function exportGlb({ textured, baseColorCanvas, stripSharedMaps, baseColorMime }) {
  if (textured) {
    const src = state.material;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: src.metalness,
      roughness: src.roughness,
      envMapIntensity: src.envMapIntensity,
      map: flipImageToTexture(baseColorCanvas, THREE.SRGBColorSpace, baseColorMime),
      ...(stripSharedMaps ? {} : {
        metalnessMap: flippedTexture(src.metalnessMap),
        normalMap: flippedTexture(src.normalMap),
        roughnessMap: flippedTexture(src.roughnessMap),
      }),
    });
    try {
      return await exportWith(mat);
    } finally {
      [mat.map, mat.metalnessMap, mat.normalMap, mat.roughnessMap].forEach((t) => t && t.dispose());
      mat.dispose();
    }
  }

  const plain = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 1, roughness: 0.5 });
  try {
    return await exportWith(plain);
  } finally {
    plain.dispose();
  }
}

/**
 * Exports the can's shared PBR maps (identical for every artwork) as PNG data
 * URLs, for runs that strip them from the per-can GLBs. The metallic-roughness
 * map replicates GLTFExporter's buildMetalRoughTexture merge byte-for-byte in
 * pixel terms (R=0, G=roughness, B=metalness, A=255 over a #00ffff fill), and
 * all maps get the same vertical flip the embedded GLB textures get, so a
 * runtime that reattaches these sees the exact textures it would have loaded
 * from an unstripped GLB.
 */
export function exportSharedMaps() {
  const src = state.material;
  const metalness = flipImageToCanvas(src.metalnessMap.image);
  const roughness = flipImageToCanvas(src.roughnessMap.image);
  const w = Math.max(metalness.width, roughness.width);
  const h = Math.max(metalness.height, roughness.height);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#00ffff';
  ctx.fillRect(0, 0, w, h);
  const composite = ctx.getImageData(0, 0, w, h);

  ctx.drawImage(metalness, 0, 0, w, h);
  const metalData = ctx.getImageData(0, 0, w, h).data;
  for (let i = 2; i < metalData.length; i += 4) composite.data[i] = metalData[i];

  ctx.drawImage(roughness, 0, 0, w, h);
  const roughData = ctx.getImageData(0, 0, w, h).data;
  for (let i = 1; i < roughData.length; i += 4) composite.data[i] = roughData[i];

  ctx.putImageData(composite, 0, 0);

  return {
    metallicRoughnessPngDataUrl: canvas.toDataURL('image/png'),
    normalPngDataUrl: flipImageToCanvas(src.normalMap.image).toDataURL('image/png'),
  };
}
