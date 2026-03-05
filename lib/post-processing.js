import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PixelArtShader } from './pixel-art-shader.js';

/**
 * Sets up an EffectComposer with a RenderPass and the PixelArt ShaderPass.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @returns {{ composer: EffectComposer, pixelArtPass: ShaderPass }}
 */
export function setupPixelArtPass(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const pixelArtPass = new ShaderPass(PixelArtShader);
  pixelArtPass.uniforms.resolution.value = new THREE.Vector2(
    window.innerWidth * renderer.getPixelRatio(),
    window.innerHeight * renderer.getPixelRatio(),
  );
  composer.addPass(pixelArtPass);
  composer.addPass(new OutputPass());

  return { composer, pixelArtPass };
}
