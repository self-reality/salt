/**
 * Pixel Art post-processing shader.
 * Combines pixelization (grid snapping) with color reduction (posterization).
 */
export const PixelArtShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: null },   // vec2 – renderer size in pixels
    pixelSize: { value: 4.0 },     // size of each "pixel block"
    colorLevels: { value: 8.0 },   // number of color steps per channel
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float pixelSize;
    uniform float colorLevels;

    varying vec2 vUv;

    void main() {
      // Snap UV to pixel grid
      vec2 dxy = pixelSize / resolution;
      vec2 snappedUv = dxy * floor(vUv / dxy) + dxy * 0.5;

      vec4 color = texture2D(tDiffuse, snappedUv);

      // Posterize
      float levels = max(colorLevels, 2.0);
      color.rgb = floor(color.rgb * levels + 0.5) / levels;

      gl_FragColor = color;
    }
  `,
};
