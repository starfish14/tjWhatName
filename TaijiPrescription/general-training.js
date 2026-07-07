let generalTrainingLoaded = false;

window.addEventListener("load", () => {
  loadGeneralTrainingArticles();
});

async function loadGeneralTrainingArticles(forceRefresh = false) {
  if (generalTrainingLoaded && !forceRefresh) return;

  const loading = document.getElementById("generalTrainingLoading");
  const empty = document.getElementById("generalTrainingEmpty");
  const list = document.getElementById("generalTrainingList");

  loading.style.display = "block";
  empty.hidden = true;
  list.textContent = "";

  try {
    const articles = await API.getGeneralTrainingArticles();
    generalTrainingLoaded = true;
    renderGeneralTrainingArticles(articles);
  } catch (error) {
    empty.hidden = false;
    empty.textContent = error.message;
  } finally {
    loading.style.display = "none";
  }
}

function renderGeneralTrainingArticles(articles) {
  const empty = document.getElementById("generalTrainingEmpty");
  const list = document.getElementById("generalTrainingList");
  list.textContent = "";

  if (!articles.length) {
    empty.hidden = false;
    empty.textContent = "暂无文章，等待后端上传内容。";
    return;
  }

  empty.hidden = true;
  articles.forEach(article => list.appendChild(createArticleCard(article)));
}

function createArticleCard(article) {
  const card = document.createElement("article");
  card.className = "blog-article-card";

  const meta = [article.category, article.author, formatArticleDate(article.updatedAt || article.createdAt)]
    .filter(Boolean)
    .join(" / ");

  const title = document.createElement("h3");
  title.textContent = article.title || "未命名文章";
  card.appendChild(title);

  if (meta) {
    const metaEl = document.createElement("p");
    metaEl.className = "blog-article-meta";
    metaEl.textContent = meta;
    card.appendChild(metaEl);
  }

  const summary = article.summary || article.excerpt || "";
  if (summary) {
    const summaryEl = document.createElement("p");
    summaryEl.className = "blog-article-summary";
    summaryEl.textContent = summary;
    card.appendChild(summaryEl);
  }

  const content = article.content || "";
  if (content) {
    const contentEl = document.createElement("div");
    contentEl.className = "blog-article-content";
    contentEl.textContent = content;
    card.appendChild(contentEl);
  }

  if (Array.isArray(article.tags) && article.tags.length) {
    const tags = document.createElement("div");
    tags.className = "blog-article-tags";
    article.tags.forEach(tag => {
      const tagEl = document.createElement("span");
      tagEl.textContent = tag;
      tags.appendChild(tagEl);
    });
    card.appendChild(tags);
  }

  return card;
}

function formatArticleDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("zh-CN");
}
