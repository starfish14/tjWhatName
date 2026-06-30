import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_ASSET =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const LANDMARK = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28
};

const cameraEl = document.querySelector("#camera");
const canvasEl = document.querySelector("#overlay");
const statusEl = document.querySelector("#status");
const toggleBtn = document.querySelector("#toggleCamera");

const overallScoreEl = document.querySelector("#overallScore");
const posePhaseEl = document.querySelector("#posePhase");
const postureValueEl = document.querySelector("#postureValue");
const smoothValueEl = document.querySelector("#smoothValue");
const stanceValueEl = document.querySelector("#stanceValue");
const rhythmValueEl = document.querySelector("#rhythmValue");
const coachListEl = document.querySelector("#coachList");

const postureBarEl = document.querySelector("#postureBar");
const smoothBarEl = document.querySelector("#smoothBar");
const stanceBarEl = document.querySelector("#stanceBar");
const rhythmBarEl = document.querySelector("#rhythmBar");

const ctx = canvasEl.getContext("2d");
const drawingUtils = new DrawingUtils(ctx);

let poseLandmarker;
let isRunning = false;
let rafId = 0;
let stream;
let lastVideoTime = -1;

let standardSequence = [];
let standardSummary;
let standardReady = false;
let standardLoadError = "";
let standardSourceLabel = "未加载";

const userSequence = [];
let lastSampleMs = 0;
let smoothedMetrics;

const STANDARD_VIDEO_PATH = "./standard/standard.mp4";
const STANDARD_CACHE_PATH = "./standard/standard_pose_sequence.json";
const STANDARD_SAMPLE_MS = 180;
const USER_SAMPLE_MS = 180;
const MAX_USER_SEQUENCE = 180;
const SCORE_SMOOTHING_ALPHA = 0.2;
const LOCAL_STANDARD_CACHE_KEY = "taiji-motion-standard-cache-v1";

const setStatus = (text) => {
  statusEl.textContent = text;
};

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const dist2d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const midpoint = (a, b) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2
});

const average = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const angleDeg = (a, b, c) => {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;

  const dot = abx * cbx + aby * cby;
  const magAB = Math.hypot(abx, aby);
  const magCB = Math.hypot(cbx, cby);

  if (!magAB || !magCB) {
    return 180;
  }

  const cosTheta = Math.min(1, Math.max(-1, dot / (magAB * magCB)));
  return (Math.acos(cosTheta) * 180) / Math.PI;
};

function setMeter(barEl, valueEl, score) {
  const pct = Math.round(clamp01(score) * 100);
  barEl.style.width = `${pct}%`;
  valueEl.textContent = `${pct}`;
}

function detectPhase(metrics) {
  if (metrics.progress < 0.2) {
    return "起势对齐";
  }

  if (metrics.progress > 0.82) {
    return "收势合劲";
  }

  if (metrics.coordinationScore > 0.72) {
    return "行云流水";
  }

  if (metrics.wristSpan > 1.55) {
    return "开势延展";
  }

  if (metrics.wristSpan < 0.9) {
    return "合势蓄劲";
  }

  return "调息行架";
}

function updateCoachTips(metrics) {
  const tips = [];

  if (metrics.postureScore < 0.55) {
    tips.push("与标准动作相比，中轴略有偏移，想象头顶被轻轻上提，保持躯干竖直。");
  }

  if (metrics.smoothScore < 0.55) {
    tips.push("动作衔接和标准视频还有差距，尝试放慢过渡，让发力更圆更连贯。");
  }

  if (metrics.stanceScore < 0.5) {
    tips.push("下盘形态和标准动作不够接近，保持膝微屈并让重心沉到胯部。");
  }

  if (metrics.rhythmScore < 0.45) {
    tips.push("节奏与标准视频不够同步，建议按开合变化放慢速度，配合呼吸稳定推进。");
  }

  if (!tips.length) {
    tips.push("与标准动作的贴合度很好，继续保持松沉、圆活、连贯的太极节奏。");
  }

  coachListEl.innerHTML = tips.map((tip) => `<li>${tip}</li>`).join("");
}

function createStandardVideoEl() {
  const video = document.createElement("video");
  video.src = STANDARD_VIDEO_PATH;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.style.display = "none";
  document.body.append(video);
  return video;
}

function waitForEvent(target, eventName) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(eventName, onResolve);
      target.removeEventListener("error", onError);
    };

    const onResolve = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error(`标准视频事件失败: ${eventName}`));
    };

    target.addEventListener(eventName, onResolve, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

function waitForSeek(videoEl, timeSec) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      videoEl.removeEventListener("seeked", onSeeked);
      videoEl.removeEventListener("error", onError);
    };

    const onSeeked = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("标准视频定位失败。"));
    };

    if (Math.abs(videoEl.currentTime - timeSec) < 0.001) {
      resolve();
      return;
    }

    videoEl.addEventListener("seeked", onSeeked, { once: true });
    videoEl.addEventListener("error", onError, { once: true });
    videoEl.currentTime = timeSec;
  });
}

function vectorDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const delta = a[i] - b[i];
    sum += delta * delta;
  }
  return Math.sqrt(sum / a.length);
}

function mapDistanceToScore(distance, tolerance = 0.45) {
  return clamp01(1 - distance / tolerance);
}

function getAdaptiveWeights(lowerBodyVis) {
  const VIS_THRESHOLD = 0.5;
  const vis = Number.isFinite(lowerBodyVis) ? lowerBodyVis : 1;
  if (vis >= VIS_THRESHOLD) {
    return { posture: 0.38, smooth: 0.28, stance: 0.20, rhythm: 0.14 };
  }
  const stanceFactor = clamp01(vis / VIS_THRESHOLD);
  const stanceWeight = 0.20 * stanceFactor;
  const freed = 0.20 - stanceWeight;
  const base = 0.38 + 0.28 + 0.14;
  return {
    posture: 0.38 + freed * (0.38 / base),
    smooth: 0.28 + freed * (0.28 / base),
    stance: stanceWeight,
    rhythm: 0.14 + freed * (0.14 / base)
  };
}

function smoothValue(previous, next, alpha = SCORE_SMOOTHING_ALPHA) {
  if (!Number.isFinite(previous)) {
    return next;
  }
  return previous + (next - previous) * alpha;
}

function summarizeSequence(sequence) {
  return {
    avgWristSpan: average(sequence.map((frame) => frame.wristSpan)),
    wristSpanRange: Math.max(...sequence.map((frame) => frame.wristSpan)) - Math.min(...sequence.map((frame) => frame.wristSpan))
  };
}

function serializeStandardSequence(sequence) {
  return {
    version: 1,
    sampleMs: STANDARD_SAMPLE_MS,
    generatedAt: new Date().toISOString(),
    sourceVideo: STANDARD_VIDEO_PATH,
    sequence
  };
}

function hydrateStandardSequence(payload) {
  const sequence = payload?.sequence;
  if (!Array.isArray(sequence) || sequence.length < 8) {
    throw new Error("标准缓存数据无效。");
  }

  standardSequence = sequence;
  standardSummary = summarizeSequence(sequence);
  standardReady = true;
}

function persistStandardCache(payload) {
  try {
    localStorage.setItem(LOCAL_STANDARD_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // 浏览器缓存失败不影响主流程。
  }
}

function tryLoadStandardCacheFromStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_STANDARD_CACHE_KEY);
    if (!raw) {
      return false;
    }

    hydrateStandardSequence(JSON.parse(raw));
    standardSourceLabel = "浏览器缓存";
    return true;
  } catch {
    return false;
  }
}

async function tryLoadStandardCacheFromFile() {
  try {
    const response = await fetch(STANDARD_CACHE_PATH, { cache: "no-store" });
    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    hydrateStandardSequence(payload);
    persistStandardCache(payload);
    standardSourceLabel = "缓存文件";
    return true;
  } catch {
    return false;
  }
}

function extractFrameFeatures(landmarks) {
  const lShoulder = landmarks[LANDMARK.LEFT_SHOULDER];
  const rShoulder = landmarks[LANDMARK.RIGHT_SHOULDER];
  const lWrist = landmarks[LANDMARK.LEFT_WRIST];
  const rWrist = landmarks[LANDMARK.RIGHT_WRIST];
  const lHip = landmarks[LANDMARK.LEFT_HIP];
  const rHip = landmarks[LANDMARK.RIGHT_HIP];
  const lKnee = landmarks[LANDMARK.LEFT_KNEE];
  const rKnee = landmarks[LANDMARK.RIGHT_KNEE];
  const lAnkle = landmarks[LANDMARK.LEFT_ANKLE];
  const rAnkle = landmarks[LANDMARK.RIGHT_ANKLE];

  const upperBodyVis = average([
    lShoulder.visibility ?? 1, rShoulder.visibility ?? 1,
    lWrist.visibility ?? 1, rWrist.visibility ?? 1
  ]);
  const lowerBodyVis = average([
    lHip.visibility ?? 1, rHip.visibility ?? 1,
    lKnee.visibility ?? 1, rKnee.visibility ?? 1,
    lAnkle.visibility ?? 1, rAnkle.visibility ?? 1
  ]);
  const overallVis = (upperBodyVis * 4 + lowerBodyVis * 6) / 10;

  const shoulderWidth = Math.max(dist2d(lShoulder, rShoulder), 0.001);
  const hipWidth = Math.max(dist2d(lHip, rHip), 0.001);
  const torsoLength = Math.max(dist2d(midpoint(lShoulder, rShoulder), midpoint(lHip, rHip)), 0.001);
  const wristSpan = dist2d(lWrist, rWrist) / shoulderWidth;

  const shoulderMid = midpoint(lShoulder, rShoulder);
  const hipMid = midpoint(lHip, rHip);

  const torsoTiltDeg = Math.abs(
    (Math.atan2(shoulderMid.x - hipMid.x, hipMid.y - shoulderMid.y) * 180) /
      Math.PI
  );

  const leftKneeAngle = angleDeg(lHip, lKnee, lAnkle);
  const rightKneeAngle = angleDeg(rHip, rKnee, rAnkle);
  const ankleSpanRatio = dist2d(lAnkle, rAnkle) / hipWidth;
  const leftWristHeight = (lShoulder.y - lWrist.y) / torsoLength;
  const rightWristHeight = (rShoulder.y - rWrist.y) / torsoLength;
  const wristCenterOffsetX = (midpoint(lWrist, rWrist).x - shoulderMid.x) / shoulderWidth;
  const wristCenterOffsetY = (midpoint(lWrist, rWrist).y - shoulderMid.y) / torsoLength;
  const kneeDiff = (leftKneeAngle - rightKneeAngle) / 90;
  const wristHeightDiff = (leftWristHeight - rightWristHeight) / 2;

  return {
    wristSpan,
    torsoTiltDeg,
    ankleSpanRatio,
    avgKneeAngle: (leftKneeAngle + rightKneeAngle) / 2,
    leftWristHeight,
    rightWristHeight,
    wristCenterOffsetX,
    wristCenterOffsetY,
    kneeDiff,
    wristHeightDiff,
    visibility: { upperBody: upperBodyVis, lowerBody: lowerBodyVis, overall: overallVis },
    vector: [
      wristSpan,
      torsoTiltDeg / 30,
      ankleSpanRatio / 1.8,
      ((leftKneeAngle + rightKneeAngle) / 2 - 150) / 35,
      leftWristHeight,
      rightWristHeight,
      wristCenterOffsetX,
      wristCenterOffsetY,
      kneeDiff,
      wristHeightDiff
    ]
  };
}

function runDtw(userFrames, referenceFrames) {
  const n = userFrames.length;
  const m = referenceFrames.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Number.POSITIVE_INFINITY));
  const prev = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
  dp[0][0] = 0;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = vectorDistance(userFrames[i - 1].vector, referenceFrames[j - 1].vector);
      const candidates = [
        [dp[i - 1][j], [i - 1, j]],
        [dp[i][j - 1], [i, j - 1]],
        [dp[i - 1][j - 1], [i - 1, j - 1]]
      ];
      candidates.sort((a, b) => a[0] - b[0]);
      dp[i][j] = cost + candidates[0][0];
      prev[i][j] = candidates[0][1];
    }
  }

  const path = [];
  let i = n;
  let j = m;

  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    [i, j] = prev[i][j];
  }

  path.reverse();
  return {
    normalizedDistance: dp[n][m] / Math.max(path.length, 1),
    path
  };
}

function buildScoreFromAlignment(userFrames, referenceFrames, dtwResult) {
  const postureDistances = [];
  const smoothDistances = [];
  const stanceDistances = [];
  const rhythmDistances = [];

  for (let index = 0; index < dtwResult.path.length; index += 1) {
    const [userIndex, refIndex] = dtwResult.path[index];
    const user = userFrames[userIndex];
    const ref = referenceFrames[refIndex];
    const prevUser = userIndex > 0 ? userFrames[userIndex - 1] : user;
    const prevRef = refIndex > 0 ? referenceFrames[refIndex - 1] : ref;

    postureDistances.push(
      Math.abs(user.torsoTiltDeg - ref.torsoTiltDeg) / 30 +
        Math.abs(user.wristCenterOffsetY - ref.wristCenterOffsetY) * 0.45
    );
    smoothDistances.push(
      vectorDistance(
        [user.wristSpan - prevUser.wristSpan, user.wristCenterOffsetX - prevUser.wristCenterOffsetX, user.wristCenterOffsetY - prevUser.wristCenterOffsetY],
        [ref.wristSpan - prevRef.wristSpan, ref.wristCenterOffsetX - prevRef.wristCenterOffsetX, ref.wristCenterOffsetY - prevRef.wristCenterOffsetY]
      )
    );
    stanceDistances.push(
      Math.abs(user.avgKneeAngle - ref.avgKneeAngle) / 45 +
        Math.abs(user.ankleSpanRatio - ref.ankleSpanRatio) / 1.2 +
        Math.abs(user.kneeDiff - ref.kneeDiff) * 0.4
    );
    rhythmDistances.push(Math.abs(user.wristSpan - ref.wristSpan) + Math.abs(user.wristHeightDiff - ref.wristHeightDiff) * 0.5);
  }

  const postureScore = mapDistanceToScore(average(postureDistances), 0.8);
  const smoothScore = mapDistanceToScore(average(smoothDistances), 0.42);
  const stanceScore = mapDistanceToScore(average(stanceDistances), 1.1);
  const rhythmScore = mapDistanceToScore(average(rhythmDistances), 0.85);
  const coordinationScore = mapDistanceToScore(dtwResult.normalizedDistance, 0.5);
  const progress =
    dtwResult.path.length && referenceFrames.length
      ? dtwResult.path[dtwResult.path.length - 1][1] / (referenceFrames.length - 1 || 1)
      : 0;

  const avgLowerBodyVis = average(userFrames.map((f) => f.visibility?.lowerBody ?? 1));

  return {
    postureScore,
    smoothScore,
    stanceScore,
    rhythmScore,
    coordinationScore,
    progress,
    wristSpan: userFrames[userFrames.length - 1]?.wristSpan ?? 0,
    lowerBodyVis: avgLowerBodyVis
  };
}

function computeDtwMetrics() {
  if (!standardReady || standardSequence.length < 8 || userSequence.length < 8) {
    return null;
  }

  const minWindow = Math.max(8, Math.floor(standardSequence.length * 0.55));
  const maxWindow = Math.min(userSequence.length, Math.max(standardSequence.length + 12, minWindow));
  let best = null;

  for (let size = minWindow; size <= maxWindow; size += 4) {
    const candidateFrames = userSequence.slice(-size);
    const dtwResult = runDtw(candidateFrames, standardSequence);
    if (!best || dtwResult.normalizedDistance < best.dtw.normalizedDistance) {
      best = {
        frames: candidateFrames,
        dtw: dtwResult
      };
    }
  }

  if (!best) {
    return null;
  }

  return buildScoreFromAlignment(best.frames, standardSequence, best.dtw);
}

function renderMetrics(metrics) {
  setMeter(postureBarEl, postureValueEl, metrics.postureScore);
  setMeter(smoothBarEl, smoothValueEl, metrics.smoothScore);
  setMeter(stanceBarEl, stanceValueEl, metrics.stanceScore);
  setMeter(rhythmBarEl, rhythmValueEl, metrics.rhythmScore);

  const weights = getAdaptiveWeights(metrics.lowerBodyVis ?? 1);
  const total = Math.round(
    (metrics.postureScore * weights.posture +
      metrics.smoothScore * weights.smooth +
      metrics.stanceScore * weights.stance +
      metrics.rhythmScore * weights.rhythm) *
      100
  );

  overallScoreEl.textContent = Number.isFinite(total) ? `${total}` : "--";
  posePhaseEl.textContent = `${detectPhase(metrics)} · 与标准动作同步 ${(metrics.progress * 100).toFixed(0)}%`;

  updateCoachTips(metrics);
}

function smoothMetrics(metrics) {
  if (!smoothedMetrics) {
    smoothedMetrics = { ...metrics };
    return smoothedMetrics;
  }

  smoothedMetrics = {
    ...metrics,
    postureScore: smoothValue(smoothedMetrics.postureScore, metrics.postureScore),
    smoothScore: smoothValue(smoothedMetrics.smoothScore, metrics.smoothScore),
    stanceScore: smoothValue(smoothedMetrics.stanceScore, metrics.stanceScore),
    rhythmScore: smoothValue(smoothedMetrics.rhythmScore, metrics.rhythmScore),
    coordinationScore: smoothValue(smoothedMetrics.coordinationScore, metrics.coordinationScore),
    progress: smoothValue(smoothedMetrics.progress, metrics.progress, 0.28),
    wristSpan: smoothValue(smoothedMetrics.wristSpan, metrics.wristSpan, 0.35),
    lowerBodyVis: metrics.lowerBodyVis
  };

  return smoothedMetrics;
}

function resizeCanvasToVideo() {
  const width = cameraEl.videoWidth;
  const height = cameraEl.videoHeight;

  if (!width || !height) {
    return;
  }

  canvasEl.width = width;
  canvasEl.height = height;
}

function drawSkeleton(landmarks) {
  drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
    color: "#86e0bc",
    lineWidth: 4
  });

  drawingUtils.drawLandmarks(landmarks, {
    color: "#ffe7a0",
    lineWidth: 1,
    radius: 3
  });

  for (const lm of landmarks) {
    if ((lm.visibility ?? 1) < 0.5) {
      ctx.beginPath();
      ctx.arc(lm.x * canvasEl.width, lm.y * canvasEl.height, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,80,80,0.75)";
      ctx.fill();
    }
  }
}

function resetMetrics() {
  overallScoreEl.textContent = "--";
  posePhaseEl.textContent = "等待动作...";
  postureValueEl.textContent = "--";
  smoothValueEl.textContent = "--";
  stanceValueEl.textContent = "--";
  rhythmValueEl.textContent = "--";
  postureBarEl.style.width = "0";
  smoothBarEl.style.width = "0";
  stanceBarEl.style.width = "0";
  rhythmBarEl.style.width = "0";
  coachListEl.innerHTML = "<li>等待检测到人体后开始反馈。</li>";

  userSequence.length = 0;
  lastSampleMs = 0;
  smoothedMetrics = undefined;
}

function appendUserFrame(frame, nowMs) {
  if (!lastSampleMs || nowMs - lastSampleMs >= USER_SAMPLE_MS) {
    userSequence.push(frame);
    lastSampleMs = nowMs;
  } else {
    userSequence[userSequence.length - 1] = frame;
  }

  if (userSequence.length > MAX_USER_SEQUENCE) {
    userSequence.shift();
  }
}

async function buildStandardSequence() {
  const standardVideoEl = createStandardVideoEl();
  await waitForEvent(standardVideoEl, "loadedmetadata");

  const durationMs = Math.max(standardVideoEl.duration * 1000, STANDARD_SAMPLE_MS);
  const sequence = [];

  for (let timeMs = 0; timeMs <= durationMs; timeMs += STANDARD_SAMPLE_MS) {
    const targetTimeSec = Math.min(timeMs / 1000, standardVideoEl.duration);
    await waitForSeek(standardVideoEl, targetTimeSec);
    const result = poseLandmarker.detectForVideo(standardVideoEl, timeMs);
    if (result.landmarks.length) {
      sequence.push(extractFrameFeatures(result.landmarks[0]));
    }
  }

  standardVideoEl.remove();

  if (sequence.length < 8) {
    throw new Error("标准视频中未提取到足够的人体关键点。");
  }

  const payload = serializeStandardSequence(sequence);
  hydrateStandardSequence(payload);
  persistStandardCache(payload);
  standardSourceLabel = "标准视频解析";
  return payload;
}

function updateWaitingStatus() {
  if (standardLoadError) {
    setStatus(`标准动作加载失败：${standardLoadError}`);
    return;
  }

  if (!standardReady) {
    setStatus("准备中：正在加载标准动作数据，请稍候...");
    return;
  }

  setStatus(`模型与标准动作已就绪：来源 ${standardSourceLabel}，点击“开启摄像头”开始。`);
}

function renderFrame(result, nowMs) {
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  if (!result.landmarks.length) {
    setStatus("未检测到人体，请完整进入画面并尽量与标准视频动作保持一致。");
    return;
  }

  const landmarks = result.landmarks[0];
  drawSkeleton(landmarks);

  const features = extractFrameFeatures(landmarks);
  appendUserFrame(features, nowMs);

  const vis = features.visibility;
  let visHint = "";
  if (vis.lowerBody < 0.4) {
    visHint = "下半身遮挡较多，下盘评分权重已自动降低。请后退让全身入镜以获得完整评估。";
  } else if (vis.overall < 0.55) {
    visHint = "身体部分遮挡，评分可能受影响。建议保持全身完整可见。";
  }

  const metrics = computeDtwMetrics();
  if (metrics) {
    const stableMetrics = smoothMetrics(metrics);
    renderMetrics(stableMetrics);
    const refSpan = standardSummary?.avgWristSpan ?? 1;
    const spanDelta = Math.abs(features.wristSpan - refSpan);
    const hint = spanDelta < 0.18
      ? `当前开合幅度接近标准动作。${visHint ? " " + visHint : ""}`
      : `当前开合幅度与标准动作仍有偏差。${visHint ? " " + visHint : ""}`;
    setStatus(`DTW 对齐中：${hint} 当前标准来源：${standardSourceLabel}。`);
  } else {
    setStatus(visHint || "正在累计动作序列，准备与标准视频进行 DTW 对齐...");
  }
}

async function predictLoop() {
  if (!isRunning) {
    return;
  }

  if (cameraEl.currentTime !== lastVideoTime) {
    lastVideoTime = cameraEl.currentTime;
    const nowMs = performance.now();
    const result = poseLandmarker.detectForVideo(cameraEl, nowMs);
    renderFrame(result, nowMs);
  }

  rafId = requestAnimationFrame(predictLoop);
}

async function initLandmarker() {
  setStatus("准备中：正在加载模型...");
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);

  try {
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_ASSET,
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.6,
      minPosePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6
    });
  } catch {
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_ASSET
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.6,
      minPosePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6
    });
  }

  updateWaitingStatus();

  try {
    const loadedFromFile = await tryLoadStandardCacheFromFile();
    const loadedFromStorage = loadedFromFile ? true : tryLoadStandardCacheFromStorage();

    if (!loadedFromFile && !loadedFromStorage) {
      await buildStandardSequence();
    }

    updateWaitingStatus();
  } catch (error) {
    standardLoadError = error?.message || "未知错误";
    updateWaitingStatus();
  }
}

async function startCamera() {
  if (!standardReady) {
    updateWaitingStatus();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("当前浏览器不支持摄像头 API。请使用新版 Chrome / Edge。");
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    cameraEl.srcObject = stream;
    await cameraEl.play();
    resizeCanvasToVideo();

    isRunning = true;
    lastVideoTime = -1;
    resetMetrics();
    toggleBtn.textContent = "停止捕捉";
    setStatus("捕捉已启动：请参考标准视频节奏，慢慢做太极动作。");

    rafId = requestAnimationFrame(predictLoop);
  } catch (error) {
    setStatus(`摄像头启动失败：${error?.message || "未知错误"}`);
  }
}

function stopCamera() {
  isRunning = false;
  cancelAnimationFrame(rafId);

  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
    stream = undefined;
  }

  cameraEl.srcObject = null;
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  toggleBtn.textContent = "开启摄像头";
  setStatus("已停止：点击“开启摄像头”重新开始。");
  resetMetrics();
}

toggleBtn.addEventListener("click", async () => {
  toggleBtn.disabled = true;

  if (isRunning) {
    stopCamera();
  } else {
    await startCamera();
  }

  toggleBtn.disabled = false;
});

window.addEventListener("resize", resizeCanvasToVideo);
cameraEl.addEventListener("loadedmetadata", resizeCanvasToVideo);

resetMetrics();
initLandmarker().catch((error) => {
  setStatus(`模型加载失败：${error?.message || "未知错误"}`);
});
