import * as THREE from 'three';

// -----------------------------------------------------------------------------
// Constant-size overlay decals for the can.
//
// Unlike the artwork (which is composited into the can's base texture and so
// stretches/deforms with the geometry), an overlay is its own thin textured
// plane stuck onto the can surface. It is sized once in world units and never
// rescaled, so it keeps the same physical size when the can is stretched — only
// its position is re-glued to the (deformed) surface each frame via update().
//
// The element is still authored in TEXTURE space: you pass the UV of where it
// should sit and its size in texture pixels. We unproject that UV onto the mesh
// to find the 3D anchor, and convert pixel size -> world size using the local
// UV->world scale, so it matches how big it would have looked baked-in at rest.
//
// Because it lives outside the base texture, it is also pregeneration-friendly:
// swapping in a pre-baked base texture or moving the xyz sliders never touches
// it — there is no canvas re-render, just a one-triangle reposition per frame.
// -----------------------------------------------------------------------------

// Scratch objects reused every update() so the per-frame path allocates nothing.
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _dPdu = new THREE.Vector3();
const _dPdv = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/**
 * Barycentric coords of (px,py) within triangle (a,b,c) in UV space.
 * Returns [w0,w1,w2] when the point is inside (small tolerance), else null.
 */
function baryUV(px, py, ax, ay, bx, by, cx, cy) {
  const v0x = bx - ax, v0y = by - ay;
  const v1x = cx - ax, v1y = cy - ay;
  const v2x = px - ax, v2y = py - ay;
  const den = v0x * v1y - v1x * v0y;
  if (Math.abs(den) < 1e-12) return null;
  const w1 = (v2x * v1y - v1x * v2y) / den;
  const w2 = (v0x * v2y - v2x * v0y) / den;
  const w0 = 1 - w1 - w2;
  const e = 1e-5;
  if (w0 < -e || w1 < -e || w2 < -e) return null;
  return [w0, w1, w2];
}

/**
 * Finds the first mesh triangle whose UVs contain (u,v) and records what's
 * needed to re-evaluate the 3D anchor later: the position attribute, the three
 * vertex indices, the constant barycentric weights, and the triangle's UVs.
 */
function findSurfaceAtUV(canGroup, u, v) {
  let hit = null;
  canGroup.traverse((child) => {
    if (hit || !child.isMesh) return;
    const geo = child.geometry;
    const uvAttr = geo.attributes.uv;
    const posAttr = geo.attributes.position;
    if (!uvAttr || !posAttr) return;

    const index = geo.index;
    const triCount = index ? index.count / 3 : posAttr.count / 3;
    for (let t = 0; t < triCount; t++) {
      const ia = index ? index.getX(t * 3)     : t * 3;
      const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;

      const bary = baryUV(
        u, v,
        uvAttr.getX(ia), uvAttr.getY(ia),
        uvAttr.getX(ib), uvAttr.getY(ib),
        uvAttr.getX(ic), uvAttr.getY(ic),
      );
      if (!bary) continue;

      hit = {
        posAttr,
        ia, ib, ic,
        w: bary,
        uv: [
          [uvAttr.getX(ia), uvAttr.getY(ia)],
          [uvAttr.getX(ib), uvAttr.getY(ib)],
          [uvAttr.getX(ic), uvAttr.getY(ic)],
        ],
      };
      break;
    }
  });
  return hit;
}

/**
 * Re-evaluates the anchor from the triangle's *current* (possibly deformed)
 * vertex positions. Writes the world position into outPos and the surface
 * orientation into outQuat, and returns the local UV->world scale lengths
 * (used once at creation to size the plane).
 */
function evalAnchor(hit, outPos, outQuat) {
  const { posAttr, ia, ib, ic, w, uv } = hit;
  _p0.fromBufferAttribute(posAttr, ia);
  _p1.fromBufferAttribute(posAttr, ib);
  _p2.fromBufferAttribute(posAttr, ic);

  outPos.set(0, 0, 0)
    .addScaledVector(_p0, w[0])
    .addScaledVector(_p1, w[1])
    .addScaledVector(_p2, w[2]);

  _e1.subVectors(_p1, _p0);
  _e2.subVectors(_p2, _p0);

  // Solve e1 = du1*dPdu + dv1*dPdv ; e2 = du2*dPdu + dv2*dPdv  for dPdu/dPdv.
  const du1 = uv[1][0] - uv[0][0], dv1 = uv[1][1] - uv[0][1];
  const du2 = uv[2][0] - uv[0][0], dv2 = uv[2][1] - uv[0][1];
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) > 1e-12) {
    const inv = 1 / det;
    _dPdu.copy(_e1).multiplyScalar(dv2).addScaledVector(_e2, -dv1).multiplyScalar(inv);
    _dPdv.copy(_e1).multiplyScalar(-du2).addScaledVector(_e2, du1).multiplyScalar(inv);
  } else {
    _dPdu.copy(_e1);
    _dPdv.copy(_e2);
  }

  // Outward face normal (the can is centered on the origin, so "outward" is the
  // hemisphere pointing away from it).
  _normal.crossVectors(_e1, _e2).normalize();
  if (_normal.dot(outPos) < 0) _normal.negate();

  // Orthonormal basis: X along +U, Z out, Y = Z x X (≈ +V when UVs aren't
  // mirrored). Maps the plane's local right/up/forward onto the surface.
  _x.copy(_dPdu).addScaledVector(_normal, -_dPdu.dot(_normal)).normalize();
  _y.crossVectors(_normal, _x);
  _basis.makeBasis(_x, _y, _normal);
  outQuat.setFromRotationMatrix(_basis);

  return { dPduLen: _dPdu.length(), dPdvLen: _dPdv.length(), normal: _normal };
}

/**
 * Adds a constant-size overlay decal onto the can.
 *
 * @param {object} opts
 * @param {THREE.Object3D} opts.canGroup - the loaded can group (its meshes carry UVs)
 * @param {string} opts.url   - image/SVG to draw on the decal
 * @param {number} opts.u     - horizontal UV of the decal center (0..1, left->right)
 * @param {number} opts.v     - vertical UV of the decal center (0..1, bottom->top)
 * @param {number} opts.wPx   - decal width in texture pixels
 * @param {number} opts.hPx   - decal height in texture pixels
 * @param {number} [opts.texSize=4096] - reference texture size the px values are in
 * @returns {{ mesh: THREE.Mesh, update: function }|null}
 */
export function addCanOverlay({ canGroup, url, u, v, wPx, hPx, texSize = 4096 }) {
  const hit = findSurfaceAtUV(canGroup, u, v);
  if (!hit) {
    console.warn(`addCanOverlay: no mesh surface found at uv (${u}, ${v})`);
    return null;
  }

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const { dPduLen, dPdvLen } = evalAnchor(hit, position, quaternion);

  // Texture-pixel size -> world size via the local UV->world scale at rest.
  const width = (wPx / texSize) * dPduLen;
  const height = (hPx / texSize) * dPdvLen;

  // Rasterize the (possibly SVG) source at 2x for crispness; transparent bg.
  const SS = 2;
  const canvas = document.createElement('canvas');
  canvas.width = wPx * SS;
  canvas.height = hPx * SS;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  texture.generateMipmaps = false;          // NPOT-safe
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    texture.needsUpdate = true;
  };
  img.onerror = () => console.error('addCanOverlay: failed to load', url);
  img.src = url;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    metalness: 0,
    roughness: 0.6,
    depthWrite: false,       // it's a thin overlay; don't fight the surface depth
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = 1;
  canGroup.add(mesh);        // skipped by the stretch deformer (no restPositions)

  // Lift slightly off the surface along the normal to avoid z-fighting.
  const offset = Math.max(width, height) * 0.03;

  function update() {
    const { normal } = evalAnchor(hit, position, quaternion);
    mesh.position.copy(position).addScaledVector(normal, offset);
    mesh.quaternion.copy(quaternion);
  }
  update();

  return { mesh, update };
}
