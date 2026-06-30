/* ===== 状态 ===== */
const HISTORY_KEY = "taiji_pro_history";

let quizData = [];
let userAnswers = {};
let currentAdvice = "";

/* ===== 初始化 ===== */
window.onload = init;

function init() {
  loadSettings();
  bindSettingsEvents();
  displayHistory();
}

/* ===== 设置面板 ===== */
function loadSettings() {
  document.getElementById("proxyUrlInput").value = API.getProxyUrl();
}

function bindSettingsEvents() {
  document.getElementById("settingsToggle").addEventListener("click", () => {
    const panel = document.getElementById("settingsPanel");
    const toggle = document.getElementById("settingsToggle");
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    panel.style.display = isOpen ? "none" : "block";
    panel.setAttribute("aria-hidden", String(isOpen));
    toggle.setAttribute("aria-expanded", String(!isOpen));
  });

  document.getElementById("proxyUrlInput").addEventListener("change", (e) => {
    API.setProxyUrl(e.target.value.trim());
  });
}

/* ===== 第一步：生成问卷 ===== */
async function generateQuiz() {
  const text = document.getElementById("userInput").value.trim();
  if (!text) return alert("请先填写症状描述");

  showLoading(true);

  try {
    quizData = await API.generateQuiz(text);
    renderQuiz();
  } catch (error) {
    alert(`问卷生成失败：${error.message}`);
  } finally {
    showLoading(false);
  }
}

function renderQuiz() {
  document.getElementById("step1").style.display = "none";
  const section = document.getElementById("quizSection");
  section.style.display = "block";

  document.getElementById("quizContainer").innerHTML = quizData.map((item, idx) => `
    <div class="question">
      <p><strong>${idx + 1}. ${item.q}</strong></p>
      <div class="options-grid">
        ${Object.entries(item.options).map(([k, v]) => `
          <div class="option-btn" onclick="selectOption(${idx}, '${k}', this)">${k}. ${v}</div>
        `).join("")}
      </div>
    </div>
  `).join("");
}

function selectOption(qIdx, key, btn) {
  const parent = btn.parentElement;
  parent.querySelectorAll(".option-btn").forEach(el => el.classList.remove("selected"));
  btn.classList.add("selected");
  userAnswers[qIdx] = `问题:${quizData[qIdx].q}, 回答:${quizData[qIdx].options[key]}`;
}

/* ===== 第二步：生成最终处方 ===== */
async function getFinalPrescription() {
  if (Object.keys(userAnswers).length < 5) return alert("请回答所有问题");

  document.getElementById("quizSection").style.display = "none";
  showLoading(true);

  const symptoms = document.getElementById("userInput").value;
  const quizSummary = Object.values(userAnswers).join("；");

  try {
    currentAdvice = await API.generatePrescription(symptoms, quizSummary);
    processResult(currentAdvice);
    saveHistory(symptoms, currentAdvice);
  } catch (error) {
    alert(`处方生成失败：${error.message}`);
    document.getElementById("quizSection").style.display = "block";
  } finally {
    showLoading(false);
  }
}

/* ===== 结果展示 + 视频匹配 ===== */
function processResult(text) {
  const resultDiv = document.getElementById("result");
  const videoContainer = document.getElementById("videoContainer");

  const match = text.match(/【推荐招式】：(.+)/);
  if (match) {
    const actionName = match[1].trim();
    videoContainer.innerHTML = `
      <video src="video/${actionName}.mp4" autoplay loop muted playsinline
        onerror="this.parentElement.style.display='none'">
        您的浏览器不支持视频
      </video>`;
    videoContainer.style.display = "block";
  } else {
    videoContainer.style.display = "none";
    videoContainer.innerHTML = "";
  }

  resultDiv.textContent = text;
  resultDiv.style.display = "block";
  document.getElementById("finalBtns").style.display = "flex";
}

/* ===== 辅助功能 ===== */
function showLoading(show) {
  document.getElementById("loading").style.display = show ? "block" : "none";
}

/* ---- 历史记录 ---- */
function saveHistory(q, a) {
  let history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  history.unshift({ id: Date.now(), query: q, answer: a, date: new Date().toLocaleDateString() });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 5)));
  displayHistory();
}

function displayHistory() {
  const list = document.getElementById("historyList");
  const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  list.innerHTML = history.map(item => `
    <div class="history-item" onclick="loadHistory('${encodeURIComponent(item.answer)}')">
      [${item.date}] ${item.query}
    </div>
  `).join("");
}

function loadHistory(encodedAnswer) {
  document.getElementById("step1").style.display = "none";
  processResult(decodeURIComponent(encodedAnswer));
}

/* ---- 导出处方 ---- */
function exportToLocal() {
  const blob = new Blob([currentAdvice], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `太极处方_${Date.now()}.txt`;
  link.click();
}
