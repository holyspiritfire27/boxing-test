const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// ---------- MediaPipe ----------
const pose = new Pose({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
});

pose.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7,
});

pose.onResults(onResults);

const camera = new Camera(video, {
  onFrame: async () => {
    await pose.send({ image: video });
  },
  width: 480,
  height: 360,
});
camera.start();

// ===================================================
// 極穩定版 SimpleBoxing
// ===================================================
class SimpleBoxing {
  constructor() {
    this.state = "INIT"; 
    // INIT → CALM → WAIT → SIGNAL → MOVING → RESULT

    this.signalTime = 0;
    this.moveStartTime = 0;

    this.reactionTime = 0;
    this.peakSpeed = 0;

    this.prevR = null;
    this.prevL = null;

    this.smoothR = 0;
    this.smoothL = 0;

    this.ALPHA = 0.5;

    // ----------- 動態門檻 -----------
    this.noiseSamples = [];
    this.NOISE_FRAMES = 30;   // 約 1 秒
    this.noiseLevel = 0;

    this.START_FACTOR = 6;   // 必須 > 雜訊 * 6
    this.CONSEC_FRAMES = 5;

    this.moveCounter = 0;

    this.lastTime = performance.now();
    this.waitStart = performance.now();
    this.delay = this.randDelay();
  }

  randDelay() {
    return 2000 + Math.random() * 2000;
  }

  dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  }

  velocity(curr, prev, prevSmooth, dt) {
    if (!prev || dt <= 0) return { v: 0, pos: curr };

    const d = this.dist(curr, prev);
    const raw = d / dt;
    const smooth = this.ALPHA * raw + (1 - this.ALPHA) * prevSmooth;

    return { v: smooth, pos: curr };
  }

  // ----------- 核心更新 -----------
  update(lm) {
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const rw = lm[15];
    const lw = lm[16];

    const r = this.velocity(rw, this.prevR, this.smoothR, dt);
    const l = this.velocity(lw, this.prevL, this.smoothL, dt);

    this.smoothR = r.v;
    this.smoothL = l.v;
    this.prevR = r.pos;
    this.prevL = l.pos;

    const maxV = Math.max(this.smoothR, this.smoothL);

    // ===================================================
    // 狀態機
    // ===================================================

    // ---------- 0. INIT ----------
    if (this.state === "INIT") {
      this.state = "CALM";
      this.noiseSamples = [];
      return;
    }

    // ---------- 1. CALM（靜止雜訊校準） ----------
    if (this.state === "CALM") {
      this.noiseSamples.push(maxV);

      if (this.noiseSamples.length >= this.NOISE_FRAMES) {
        const avg =
          this.noiseSamples.reduce((a, b) => a + b, 0) /
          this.noiseSamples.length;

        this.noiseLevel = avg;
        this.state = "WAIT";
        this.waitStart = now;
        this.delay = this.randDelay();
      }
      return;
    }

    // ---------- 2. WAIT ----------
    if (this.state === "WAIT") {
      if (now - this.waitStart > this.delay) {
        this.state = "SIGNAL";
        this.signalTime = now;
        this.moveCounter = 0;
      }
      return;
    }

    // ---------- 3. SIGNAL ----------
    if (this.state === "SIGNAL") {
      const startThreshold = this.noiseLevel * this.START_FACTOR;

      if (maxV > startThreshold) {
        this.moveCounter++;
      } else {
        this.moveCounter = 0;
      }

      if (this.moveCounter >= this.CONSEC_FRAMES) {
        this.moveStartTime = now;
        this.reactionTime =
          (this.moveStartTime - this.signalTime) / 1000;
        this.peakSpeed = 0;
        this.state = "MOVING";
      }
      return;
    }

    // ---------- 4. MOVING ----------
    if (this.state === "MOVING") {
      this.peakSpeed = Math.max(this.peakSpeed, maxV);

      if (now - this.moveStartTime > 1000) {
        this.state = "RESULT";
      }
      return;
    }

    // ---------- 5. RESULT ----------
    if (this.state === "RESULT") {
      if (now - this.moveStartTime > 3000) {
        this.reset();
      }
      return;
    }
  }

  reset() {
    this.state = "CALM";
    this.noiseSamples = [];
    this.moveCounter = 0;

    this.prevR = null;
    this.prevL = null;
    this.smoothR = 0;
    this.smoothL = 0;
  }
}

const analyst = new SimpleBoxing();

// ===================================================
// UI
// ===================================================
function drawUI() {
  ctx.fillStyle = "white";
  ctx.font = "32px sans-serif";

  if (analyst.state === "CALM") {
    ctx.fillText("請保持靜止…", 40, 60);
  }

  if (analyst.state === "WAIT") {
    ctx.fillText("準備中…", 40, 60);
  }

  if (analyst.state === "SIGNAL") {
    ctx.fillStyle = "yellow";
    ctx.font = "48px sans-serif";
    ctx.fillText("出拳！", canvas.width/2 - 70, canvas.height/2);
  }

  if (analyst.state === "MOVING") {
    ctx.fillStyle = "lime";
    ctx.font = "28px sans-serif";
    ctx.fillText("偵測出拳中…", 40, 60);
  }

  if (analyst.state === "RESULT") {
    ctx.fillStyle = "cyan";
    ctx.font = "32px sans-serif";
    ctx.fillText(
      `反應時間: ${analyst.reactionTime.toFixed(3)} s`,
      40,
      80
    );
    ctx.fillText(
      `最大拳速: ${analyst.peakSpeed.toFixed(3)}`,
      40,
      130
    );
  }
}

// ===================================================
// 主回呼
// ===================================================
function onResults(results) {
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  if (!results.poseLandmarks) return;

  analyst.update(results.poseLandmarks);
  drawUI();
}
