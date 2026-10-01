// Webcam + MediaPipe hand tracking. Calls onFrame(frame) once per video frame with
//   { x, y, pinching, ratio, points }   (all coords normalized 0..1 and mirrored)
// or onFrame(null) when no hand is visible. Nothing ever leaves the browser.
import { pinchRatio, nextPinch, smooth } from "./gesture.js";

const MP_VERSION = "0.10.14";
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class HandTracker {
  constructor(video, onFrame) {
    this.video = video;
    this.onFrame = onFrame;
    this.running = false;
    this.landmarker = null;
  }

  // onStep(message) reports progress so the UI can show what is happening.
  async start(onStep = () => {}) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error("Camera needs HTTPS"), { name: "InsecureContext" });
    }
    onStep("Waiting for camera permission…");
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    if (!this.landmarker) {
      onStep("Loading hand-tracking model…");
      // Loaded on demand so mouse-only players never download the ~8 MB model.
      const { HandLandmarker, FilesetResolver } = await import(MP_URL);
      const vision = await FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
      const make = (delegate) => HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numHands: 1,
      });
      try {
        this.landmarker = await make("GPU");
      } catch {
        this.landmarker = await make("CPU"); // some machines have no usable WebGL
      }
    }

    this.running = true;
    this.pinching = false;
    this.cursor = null;
    this.lastVideoTime = -1;
    this.loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.onFrame(null);
  }

  get videoSize() {
    return { w: this.video.videoWidth || 640, h: this.video.videoHeight || 480 };
  }

  loop() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(() => this.loop());
    // Only run the model when the camera has produced a new frame.
    if (this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, performance.now());
    const hand = result.landmarks?.[0];
    if (!hand) {
      this.pinching = false;
      this.cursor = null;
      this.onFrame(null);
      return;
    }

    const ratio = pinchRatio(hand);
    this.pinching = nextPinch(this.pinching, ratio);
    // Cursor = midpoint of thumb tip and index tip. x is mirrored to match the mirrored video.
    const raw = { x: 1 - (hand[4].x + hand[8].x) / 2, y: (hand[4].y + hand[8].y) / 2 };
    this.cursor = smooth(this.cursor, raw);
    this.onFrame({
      ...this.cursor,
      pinching: this.pinching,
      ratio,
      points: hand.map((p) => ({ x: 1 - p.x, y: p.y })),
    });
  }
}
