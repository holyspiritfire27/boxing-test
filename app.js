const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// ---------- MediaPipe Pose ----------
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

// ---------- 核心邏輯（簡化穩定版） ----------
class SimpleBoxing {
  constructor() {
    this.state = "WAIT"; // WAIT → SIGNAL → MOVING → RESULT

    this.signalTime = 0;
    this.moveStartTime = 0;

    this.reactionTime = 0;
    this.peakSpeed = 0;

    this.prevR = null;
    this.prevL = null;

    this.smoothR = 0;
    this.smoothL = 0;

    this.ALPHA = 0.5;

    // ===== 抗雜訊關鍵參數 =====
    this.MIN_MOVE_DIST = 0.015;  // 最小位移門檻（越大越不敏感）
    this.START_VEL = 0.10;       // 啟動速度門檻
    this.CONSEC_FRAMES = 4;     // 連續幀確認

    this.moveCounter = 0;

    this.lastTime = performance.now();
    this.waitStart = performance.now();
    this.delay = this.randDelay();
  }

  randDelay() {
    return 2000 + Math.random() * 2000; // 2~4 秒
  }

  dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  velocity(curr, prev, prevSmooth, dt) {
    if (!prev || dt <= 0) return { v: 0, pos: curr };

    const d = this.dist(curr, prev);

    // ── 防線 1：位移太小直接忽略 ──
    if (d < this.MIN_MOVE_DIST) {
      return { v: 0, pos: curr };
    }

    const raw = d / dt;
    const smooth = this.ALPHA * raw + (1 - this.ALPHA) * prevSmooth;

    return { v: smooth, pos: curr };
  }

  update(lm) {
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const rw = lm[15]; // 右手腕
    const lw = lm[16]; // 左手腕

    const r = this.velocity(rw, this.prevR, this.smoothR, dt);
    const l = this.velocity(lw, this.prevL, this.smoothL, dt);

    this.smoothR = r.v;
    this.smoothL = l.v;
    this.prevR = r.pos;
    this.prevL = l.pos;

    const maxV = Math.max(this.smoothR, this.smoothL);

    // ---------- 狀態機 ----------
    if (this.state === "WAIT") {
      if (now - this.waitStart > this.delay) {
        this.state = "SIGNAL";
        this.signalTime = now;
        this.moveCounter = 0;
      }
    }

    else if (this.state === "SIGNAL") {
      // ── 防線 2+3：連續幀 + 速度門檻 ──
      if (maxV > this.START_VEL) {
        this.moveCounter++;
      } else {
        this.moveCounter = 0;
      }

      if (this.moveCounter >= this.CONSEC_FRAMES) {
        this.moveStartTime = now;
        this.reactionTime =
          (this.moveStartTime - this.signalTime) / 1000;
        this.state = "MOVING";
      }
    }

    else if (this.state === "MOVING") {
      this.peakSpeed = Math.max(this.peakSpeed, maxV);
      if (now - this.moveStartTime > 1000) {
        this.state = "RESULT";
      }
    }

    else if (this.state === "RESULT") {
      if (now - this.moveStartTime > 3000) {
        this.reset();
      }
    }
  }

  reset() {
    this.state = "WAIT";
    this.waitStart = performance.now();
    this.delay = this.randDelay();

    this.peakSpeed = 0;
    this.prevR = null;
    this.prevL = null;
    this.smoothR = 0;
    this.smoothL = 0;
    this.moveCounter = 0;
  }
}

const analyst = new SimpleBoxing();

// ---------- UI ----------
function drawUI() {
  ctx.fillStyle = "white";
  ctx.font = "32px sans-serif";

  if (analyst.state === "WAIT") {
    ctx.fillText("準備中…", 40, 60);
  }

  if (analyst.state === "SIGNAL") {
    ctx.fillStyle = "yellow";
    ctx.font = "48px sans-serif";
    ctx.fillText("出拳！", canvas.width / 2 - 70, canvas.height / 2);
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

// ---------- 主回呼 ----------
function onResults(results) {
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  if (!results.poseLandmarks) return;

  analyst.update(results.poseLandmarks);
  drawUI();
}
