const API = (() => {
  const STORAGE_KEY = "taiji_proxy_url";

  let proxyUrl = localStorage.getItem(STORAGE_KEY) || "/api/chat";

  function getProxyUrl() {
    return proxyUrl;
  }

  function setProxyUrl(url) {
    proxyUrl = url || "/api/chat";
    localStorage.setItem(STORAGE_KEY, proxyUrl);
  }


  async function chatCompletion(messages, responseFormat) {
    const body = { messages };
    if (responseFormat) body.response_format = responseFormat;

    let response;
    try {
      response = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch {
      throw new Error("无法连接后端服务，请检查网络或代理地址。");
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("后端返回了无法解析的响应。");
    }

    if (!response.ok) {
      const msg = data?.error?.message || data?.error || `后端返回状态 ${response.status}`;
      throw new Error(msg);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("后端未返回有效 AI 内容。");
    }

    return content;
  }


  /**
   * 根据症状生成 5 道辩证问卷
   */
  async function generateQuiz(symptoms) {
    const prompt = `你是一位太极养生专家。基于用户描述："${symptoms}"，请生成5道单选题。
要求：每题4个选项，直接输出JSON数组，出题内容为辅助用户更好地描述自己身体的不适，格式如下：
[{"q":"问题内容","options":{"A":"选项1","B":"选项2","C":"选项3","D":"选项4"}}]
不要输出任何Markdown标记或多余文字。`;

    const raw = await chatCompletion(
      [{ role: "user", content: prompt }],
      { type: "json_object" }
    );
    return parseQuizJSON(raw);
  }

  /**
   * 综合症状 + 问卷答案，生成最终太极处方
   */
  async function generatePrescription(symptoms, quizAnswers) {
    const prompt = `你是一位精通太极拳与中医养生的专家。
用户初诉：${symptoms}
辩证细节：${quizAnswers}

请输出纯文本处方，且只推荐一个招式。严禁使用Markdown（如#或*符号）。
格式必须严格如下：
【推荐招式】：(仅写招式名称)
【调理原理】：(100字以内)
【动作要点】：(简要步骤)
【养生建议】：(生活细节)`;

    return await chatCompletion([{ role: "user", content: prompt }]);
  }

  /* ---- 工具 ---- */
  function parseQuizJSON(raw) {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end === -1 || end < start) {
      throw new Error("问卷数据格式不正确。");
    }
    return JSON.parse(raw.slice(start, end + 1));
  }

  return { getProxyUrl, setProxyUrl, chatCompletion, generateQuiz, generatePrescription };
})();
