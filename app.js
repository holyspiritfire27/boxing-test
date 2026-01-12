const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// ----------------------
// MediaPipe Pose
// ----------------------
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

// ----------------------
// 簡化版 Boxing Analyst
// ----------------------
class SimpleBoxing {
  constructor() {
    this.state = "WAIT";   // WAIT → SIGNAL → MOVING → RESULT

    this.signalTime = 0;
    this.moveStartTime = 0;

    this.reactionTime = 0;
    this.peakSpeed = 0;

    this.prevPosR = null;
    this.prevPosL = null;

    this.smoothVelR = 0;
    this.smoothVelL = 0;

    this.ALPHA = 0.6;
    this.VELOCITY_THRESHOLD = 0.8; // 啟動拳速閾值 (m/s 模擬)

    this.lastTime = performance.now();

    this.waitStart = performance.now();
    this.randomDelay = this.randDelay();
  }

  randDelay() {
    return 2000 + Math.random() * 2000; // 2~4 秒
  }

  dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  }

  getVelocity(curr, prev, prevSmooth, dt) {
    if (!prev || dt <= 0) return { v: 0, pos: curr };

    const d = this.dist(curr, prev);
    const raw = d / dt;         // 這裡是「比例速度」
    const smooth = this.ALPHA * raw + (1 - this.ALPHA) * prevSmooth;

    return { v: smooth, pos: curr };
  }

  update(lm) {
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const rw = lm[15]; // 右手腕
    const lw = lm[16]; // 左手腕

    // 平滑速度
    let r = this.getVelocity(rw, this.prevPosR, this.smoothVelR, dt);
    let l = this.getVelocity(lw, this.prevPosL, this.smoothVelL, dt);

    this.smoothVelR = r.v;
    this.smoothVelL = l.v;
    this.prevPosR = r.pos;
    this.prevPosL = l.pos;

    const maxVel = Math.max(this.smoothVelR, this.smoothVelL);
    this.peakSpeed = Math.max(this.peakSpeed, maxVel);

    // ---------------- 狀態機 ----------------
    if (this.state === "WAIT") {
      if (now - this.waitStart > this.randomDelay) {
        this.state = "SIGNAL";
        this.signalTime = now;
      }
    }

    else if (this.state === "SIGNAL") {
      // 偵測開始出拳
      if (maxVel > this.VELOCITY_THRESHOLD) {
        this.moveStartTime = now;
        this.reactionTime = (this.moveStartTime - this.signalTime) / 1000;
        this.state = "MOVING";
      }
    }

    else if (this.state === "MOVING") {
      // 1 秒後進結果
      if ((now - this.moveStartTime) > 1000) {
        this.state = "RESULT";
      }
    }

    else if (this.state === "RESULT") {
      // 停 2 秒自動重來
      if ((now - this.moveStartTime) > 3000) {
        this.reset();
      }
    }
  }

  reset() {
    this.state = "WAIT";
    this.waitStart = performance.now();
    this.randomDelay = this.randDelay();

    this.peakSpeed = 0;
    this.prevPosR = null;
    this.prevPosL = null;
    this.smoothVelR = 0;
    this.smoothVelL = 0;
  }
}

const analyst = new SimpleBoxing();

// ----------------------
// 繪圖 & UI
// ----------------------
function drawUI() {
  ctx.fillStyle = "white";
  ctx.font = "32px sans-serif";

  if (analyst.state === "WAIT") {
    ctx.fillText("準備…", 40, 60);
  }

  if (analyst.state === "SIGNAL") {
    ctx.fillStyle = "yellow";
    ctx.font = "48px sans-serif";
    ctx.fillText("出拳！", canvas.width/2 - 70, canvas.height/2);
  }

  if (analyst.state === "MOVING") {
    ctx.fillStyle = "lime";
    ctx.fillText("偵測中…", 40, 60);
  }

  if (analyst.state === "RESULT") {
    ctx.fillStyle = "cyan";
    ctx.font = "32px sans-serif";
    ctx.fillText(`反應時間: ${analyst.reactionTime.toFixed(3)} s`, 40, 80);
    ctx.fillText(`最大拳速: ${analyst.peakSpeed.toFixed(2)} (比例)`, 40, 130);
  }
}

// ----------------------
// 主回呼
// ----------------------
function onResults(results) {
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  if (!results.poseLandmarks) return;

  analyst.update(results.poseLandmarks);
  drawUI();
}
