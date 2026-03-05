import { runTestScene } from './scenes/test.js';
import { runQueue1Scene } from './scenes/queue-1.js';

const scene = new URLSearchParams(location.search).get('scene') ?? 'queue-1';

if (scene === 'test') {
  runTestScene();
} else {
  runQueue1Scene();
}
