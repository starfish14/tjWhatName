/**
 * 太极拳知识闯关 - 答题引擎
 * 依赖：data.js（题库数据需先加载）
 */

/* ===== 配置 ===== */
const SCORE_PER_QUESTION = 10;
const TOTAL_QUESTIONS = 25;       // 每轮随机抽取的题目数

/* ===== 状态 ===== */
let currentIdx = 0;
let score = 0;
let selectedQuizData = [];

/* ===== DOM 引用 ===== */
const container    = document.getElementById('quiz-container');
const scoreEl      = document.getElementById('score');
const progressEl   = document.getElementById('progress');
const progressText = document.getElementById('progress-text');

/* ===== 工具函数 ===== */
function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

/* ===== 初始化 ===== */
function init() {
  if (!quizData || quizData.length === 0) {
    container.innerHTML = '<div class="quiz-card"><p>题库为空，请在代码中添加题目。</p></div>';
    return;
  }

  const numToSelect = Math.min(TOTAL_QUESTIONS, quizData.length);
  selectedQuizData = shuffleArray(quizData).slice(0, numToSelect);

  currentIdx = 0;
  score = 0;

  renderQuestion();
  updateStatus();
}

/* ===== 状态栏更新 ===== */
function updateStatus() {
  scoreEl.textContent = score;
  const total = selectedQuizData.length;
  const current = Math.min(currentIdx + 1, total);
  progressText.textContent = `${current}/${total}`;
  const percent = ((current - 1) / total) * 100;
  progressEl.style.width = `${percent}%`;
}

/* ===== 渲染题目 ===== */
function renderQuestion() {
  if (currentIdx >= selectedQuizData.length) {
    showResult();
    return;
  }

  const data = selectedQuizData[currentIdx];
  const card = document.createElement('div');
  card.className = 'quiz-card';

  /* 题型标签 */
  const badgeMap = {
    choice: ['type-choice', '单项选择题'],
    judge:  ['type-judge',  '判断题'],
    theory: ['type-theory', '理论简答题 (自测)']
  };
  const [badgeClass, badgeText] = badgeMap[data.type] || ['', ''];
  const badge = `<span class="type-badge ${badgeClass}">${badgeText}</span>`;
  const qText = `<div class="question-text">${data.question}</div>`;

  let contentHtml = '';

  if (data.type === 'choice') {
    contentHtml = '<div class="options-container">';
    data.options.forEach((opt, idx) => {
      contentHtml += `<button class="option-btn" onclick="handleChoice(${idx}, this)">${opt}</button>`;
    });
    contentHtml += '</div>';
    contentHtml += `<div class="explanation" id="explanation-box" style="display:none;"><strong>💡 解析：</strong>${data.explanation}</div>`;
  }
  else if (data.type === 'judge') {
    contentHtml = `
      <div class="options-container judge-options">
        <button class="option-btn btn-true"  onclick="handleJudge(true, this)">✅ 正确</button>
        <button class="option-btn btn-false" onclick="handleJudge(false, this)">❌ 错误</button>
      </div>
      <div class="explanation" id="explanation-box" style="display:none;"><strong>💡 解析：</strong>${data.explanation}</div>`;
  }
  else if (data.type === 'theory') {
    contentHtml = `
      <div class="theory-content">
        <p style="color:#666; font-style:italic; margin-bottom:20px;">💡 请先思考答案，然后点击下方按钮查看解析并自评</p>
        <button class="reveal-btn" onclick="revealTheory(this)">查看答案与解析</button>
        <div class="theory-answer-box" id="theory-answer-box" style="display:none;">
          <h4>参考答案：</h4>
          <p>${data.answerText}</p>
          <hr style="border:0; border-top:1px dashed #ccc; margin:15px 0;">
          <p><strong>💡 解析：</strong>${data.explanation}</p>
        </div>
        <div class="theory-actions" id="theory-actions" style="display:none;">
          <p style="margin-bottom:15px; font-weight:bold;">你觉得你答对了吗？</p>
          <button class="self-eval-btn btn-self-correct" onclick="handleSelfEval(true)">✅ 我答对了 (得满分)</button>
          <button class="self-eval-btn btn-self-wrong" onclick="handleSelfEval(false)">❌ 没答对/不会 (不得分)</button>
        </div>
      </div>`;
  }

  const isLast = currentIdx === selectedQuizData.length - 1;
  const actionArea = `
    <div class="action-area">
      <button class="next-btn" id="next-btn" style="display:none;" onclick="nextQuestion()">
        ${isLast ? '查看最终成绩' : '下一题'}
      </button>
    </div>`;

  card.innerHTML = badge + qText + contentHtml + actionArea;
  container.innerHTML = '';
  container.appendChild(card);
}

/* ===== 选择题处理 ===== */
window.handleChoice = function (selectedIdx, btn) {
  if (btn.disabled) return;
  const data = selectedQuizData[currentIdx];
  const buttons = document.querySelectorAll('.option-btn');

  buttons.forEach(b => b.disabled = true);

  if (selectedIdx === data.answer) {
    btn.classList.add('correct');
    score += SCORE_PER_QUESTION;
  } else {
    btn.classList.add('incorrect');
    if (data.answer >= 0 && data.answer < buttons.length) {
      buttons[data.answer].classList.add('correct');
    }
  }

  showFeedback();
};

/* ===== 判断题处理 ===== */
window.handleJudge = function (userAnswer, btn) {
  if (btn.disabled) return;
  const data = selectedQuizData[currentIdx];
  const buttons = document.querySelectorAll('.option-btn');

  buttons.forEach(b => b.disabled = true);

  if (userAnswer === data.answer) {
    btn.classList.add('correct');
    score += SCORE_PER_QUESTION;
  } else {
    btn.classList.add('incorrect');
    const correctIndex = data.answer ? 0 : 1;
    buttons[correctIndex].classList.add('correct');
  }

  showFeedback();
};

/* ===== 显示解析和下一题 ===== */
function showFeedback() {
  const expBox = document.getElementById('explanation-box');
  if (expBox) expBox.style.display = 'block';

  const nextBtn = document.getElementById('next-btn');
  if (nextBtn) nextBtn.style.display = 'inline-block';

  updateStatus();
}

/* ===== 简答题：显示答案 ===== */
window.revealTheory = function (btn) {
  btn.style.display = 'none';
  document.getElementById('theory-answer-box').style.display = 'block';
  document.getElementById('theory-actions').style.display = 'block';
};

/* ===== 简答题自评 ===== */
window.handleSelfEval = function (isCorrect) {
  if (isCorrect) {
    score += SCORE_PER_QUESTION;
    document.getElementById('theory-actions').innerHTML =
      '<p style="color:var(--success-color); font-weight:bold;">🎉 很棒！已计入得分。</p>';
  } else {
    document.getElementById('theory-actions').innerHTML =
      '<p style="color:#7f8c8d;">没关系，记住知识点下次再战！</p>';
  }

  updateStatus();
  showFeedback();
};

/* ===== 下一题 ===== */
window.nextQuestion = function () {
  currentIdx++;
  renderQuestion();
};

/* ===== 结果页 ===== */
function showResult() {
  const totalScore = selectedQuizData.length * SCORE_PER_QUESTION;
  const percentage = totalScore === 0 ? 0 : Math.round((score / totalScore) * 100);

  let msg = "";
  let color = "";
  if (percentage === 100)       { msg = "🏆 宗师境界！完美通关！"; color = "#27ae60"; }
  else if (percentage >= 80)   { msg = "🥇 高手风范！表现优异！"; color = "#2980b9"; }
  else if (percentage >= 60)   { msg = "🥈 渐入佳境！继续加油！"; color = "#f39c12"; }
  else                         { msg = "🥉 初出茅庐！多加练习！"; color = "#c0392b"; }

  const circleStyle = `background: conic-gradient(${color} ${percentage}%, #eee ${percentage}%);`;

  container.innerHTML = `
    <div class="quiz-card result-card">
      <h2 style="color:${color}; margin-bottom:30px;">闯关结束</h2>
      <div class="score-circle" style="${circleStyle}">
        <div class="score-inner">
          <span class="final-score">${score}</span>
          <span style="font-size:0.9rem; color:#999">/ ${totalScore}</span>
        </div>
      </div>
      <p class="final-msg" style="font-weight:bold; font-size:1.3rem;">${msg}</p>
      <p style="color:#777; margin-top:10px;">正确率：${percentage}%</p>
      <button class="next-btn" style="display:inline-block; margin-top:30px;" onclick="location.reload()">
        再试一次（重新随机抽题）
      </button>
    </div>`;

  progressEl.style.width = '100%';
  progressText.textContent = `${selectedQuizData.length}/${selectedQuizData.length}`;
}

/* ===== 启动 ===== */
init();
