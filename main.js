import { runTestScene } from './scenes/test.js';
import { runQueue1Scene } from './scenes/queue-1.js';
import { runLandingScene } from './scenes/landing.js';
import { runVanCanScene } from './scenes/van-can.js';

const scene = new URLSearchParams(location.search).get('scene') ?? 'landing';

if (scene === 'test') {
  runTestScene();
} else if (scene === 'queue-1') {
  runQueue1Scene();
} else if (scene === 'van-can') {
  runVanCanScene();
} else {
  runLandingScene();
}
