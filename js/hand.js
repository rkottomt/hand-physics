// Webcam + MediaPipe hand tracking.
// Exposes startHandTracking(), which calls onHand({ x, y, pinching }) every frame
// with x/y normalized to 0..1 (already mirrored), or onHand(null) when no hand is seen.
import { HandLandmarker, FilesetResolver } from
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Pinch = thumb tip and index tip are close, relative to the size of the hand.
// Two thresholds (hysteresis) stop the grab from flickering on/off at the boundary.
const PINCH_ON = 0.35;
const PINCH_OFF = 0.5;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export async function startHandTracking(video, onHand) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
  });
  video.srcObject = stream;
  await video.play();

  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 1,
  });

  let pinching = false;
  let lastTime = -1;

  function loop() {
    if (video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      const result = landmarker.detectForVideo(video, performance.now());
      const hand = result.landmarks[0];

      if (!hand) {
        pinching = false;
        onHand(null);
      } else {
        const thumb = hand[4], index = hand[8];
        const handSize = dist(hand[0], hand[9]); // wrist -> middle knuckle
        const ratio = dist(thumb, index) / handSize;
        pinching = pinching ? ratio < PINCH_OFF : ratio < PINCH_ON;

        // Cursor is the midpoint of thumb and index; mirror x to match the video.
        onHand({
          x: 1 - (thumb.x + index.x) / 2,
          y: (thumb.y + index.y) / 2,
          pinching,
        });
      }
    }
    requestAnimationFrame(loop);
  }
  loop();
}
