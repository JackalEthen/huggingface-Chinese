(() => {
  const DICT_KEY = "hf-zh-dict";
  let dict = {};
  let enabled = true;

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA", "NOSCRIPT"]);
  const TEXT_TAGS = new Set([
    "A", "BUTTON", "SPAN", "DIV", "P", "LI", "TD", "TH", "H1", "H2", "H3",
    "H4", "H5", "H6", "LABEL", "OPTION", "STRONG", "EM", "SMALL", "SUMMARY",
  ]);
  const PLACEHOLDER_TAGS = new Set(["INPUT"]);

  // 回滚记录：译文 -> 原文，关闭开关时逆映射恢复
  const revertMap = new Map();
  // 归一化匹配：去多余空白 + 小写 key 索引
  let normDict = {};
  function buildNorm() {
    normDict = {};
    for (const [k, v] of Object.entries(dict)) {
      if (k === "_v") continue;
      normDict[k.replace(/\s+/g, " ").trim().toLowerCase()] = v;
    }
  }
  function lookup(raw) {
    return normDict[raw.replace(/\s+/g, " ").trim().toLowerCase()];
  }

  // ---------- 相对时间中文化 ----------
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function localizeTime(s) {
    let m;
    if ((m = s.match(/^just now$/i))) return "刚刚";
    if ((m = s.match(/^(\d+)\s+seconds?\s+ago$/i))) return `${m[1]} 秒前`;
    if ((m = s.match(/^about\s+(\d+)\s+seconds?\s+ago$/i))) return `约 ${m[1]} 秒前`;
    if ((m = s.match(/^(\d+)\s+minutes?\s+ago$/i))) return `${m[1]} 分钟前`;
    if ((m = s.match(/^about\s+(\d+)\s+minutes?\s+ago$/i))) return `约 ${m[1]} 分钟前`;
    if ((m = s.match(/^(\d+)\s+hours?\s+ago$/i))) return `${m[1]} 小时前`;
    if ((m = s.match(/^about\s+(\d+)\s+hours?\s+ago$/i))) return `约 ${m[1]} 小时前`;
    if ((m = s.match(/^a day ago$/i))) return "1 天前";
    if ((m = s.match(/^(\d+)\s+days?\s+ago$/i))) return `${m[1]} 天前`;
    if ((m = s.match(/^about\s+(\d+)\s+days?\s+ago$/i))) return `约 ${m[1]} 天前`;
    if ((m = s.match(/^a month ago$/i))) return "1 个月前";
    if ((m = s.match(/^(\d+)\s+months?\s+ago$/i))) return `${m[1]} 个月前`;
    if ((m = s.match(/^about\s+(\d+)\s+months?\s+ago$/i))) return `约 ${m[1]} 个月前`;
    if ((m = s.match(/^a year ago$/i))) return "1 年前";
    if ((m = s.match(/^(\d+)\s+years?\s+ago$/i))) return `${m[1]} 年前`;
    // 绝对日期："Aug 14" / "Sep 17" / "Jan 9, 2024"
    if ((m = s.match(/^([A-Z][a-z]{2})\s+(\d{1,2})(?:,\s*(\d{4}))?$/))) {
      const mi = MONTHS.indexOf(m[1]);
      if (mi >= 0) return m[3] ? `${m[3]}年${mi + 1}月${m[2]}日` : `${mi + 1}月${m[2]}日`;
    }
    return null;
  }

  // ---------- 规则翻译层 ----------
  // 词典无法穷尽的动态/组合文案，用正则兜底
  function applyRules(s) {
    let m;
    if ((m = s.match(/^Updated (.+)$/))) {
      const t = localizeTime(m[1]);
      return t ? `更新于 ${t}` : null;
    }
    if ((m = s.match(/^([\d,.]+[KMBT]?)\s+rows?$/))) return `${m[1]} 行`;
    if ((m = s.match(/^(\d[\d,.]*)\s+models?$/))) return `${m[1]} 个模型`;
    if ((m = s.match(/^(\d[\d,.]*)\s+items?$/))) return `${m[1]} 项`;
    if ((m = s.match(/^(\d[\d,.]*)\s+languages?$/))) return `${m[1]} 种语言`;
    if ((m = s.match(/^(\d[\d,.]*)\s+Spaces?$/))) return `${m[1]} 个空间`;
    if ((m = s.match(/^(\d[\d,.]*)\s+datasets?$/))) return `${m[1]} 个数据集`;
    if ((m = s.match(/^\+ ?(\d[\d,.]*) languages?$/))) return `+ ${m[1]} 种语言`;
    if ((m = s.match(/^\+ ?(\d+)$/))) return `+ ${m[1]}`;
    if ((m = s.match(/^View (\d[\d,.]*) collections?$/))) return `查看 ${m[1]} 个收藏集`;
    if ((m = s.match(/^(.+?)\s+params$/))) return `${m[1]} 参数`;
    return null;
  }

  function lookupAny(raw) {
    const hit = lookup(raw);
    if (hit && hit !== raw) return hit;
    const s = raw.replace(/\s+/g, " ").trim();
    return localizeTime(s) || applyRules(s);
  }

  function translateTextNode(node) {
    if (!node || !node.nodeValue) return;
    const raw = node.nodeValue;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const hit = lookupAny(trimmed);
    if (hit && trimmed !== hit && !revertMap.has(trimmed)) {
      revertMap.set(hit, trimmed);
      node.nodeValue = raw.replace(trimmed, hit);
    }
  }

  function revertAll() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const pending = [];
    while (walker.nextNode()) pending.push(walker.currentNode);
    for (const n of pending) {
      const t = n.nodeValue.trim();
      const orig = revertMap.get(t);
      if (orig) n.nodeValue = n.nodeValue.replace(t, orig);
    }
    revertMap.clear();
    // placeholder/title 已译属性同样恢复
    for (const el of document.querySelectorAll("[data-hfzh-ph]")) {
      el.setAttribute("placeholder", el.getAttribute("data-hfzh-ph"));
      el.removeAttribute("data-hfzh-ph");
    }
  }

  function translateElement(el) {
    if (SKIP_TAGS.has(el.tagName)) return;
    if (PLACEHOLDER_TAGS.has(el.tagName)) {
      const ph = el.getAttribute("placeholder");
      if (ph) {
        const hit = lookupAny(ph);
        if (hit) {
          if (!el.hasAttribute("data-hfzh-ph")) el.setAttribute("data-hfzh-ph", ph);
          el.setAttribute("placeholder", hit);
        }
      }
      return;
    }
    if (!TEXT_TAGS.has(el.tagName)) return;
    for (const child of el.childNodes) {
      if (child.nodeType === 3) translateTextNode(child);
    }
    const title = el.getAttribute("title");
    if (title) {
      const hit = lookupAny(title);
      if (hit) {
        if (!el.hasAttribute("data-hfzh-title")) el.setAttribute("data-hfzh-title", title);
        el.setAttribute("title", hit);
      }
    }
  }

  function walk(root) {
    if (!enabled || !root) return;
    if (root.nodeType === 3) { translateTextNode(root); return; }
    if (root.nodeType !== 1) return;
    if (SKIP_TAGS.has(root.tagName)) return;
    translateElement(root);
    for (const child of root.children) walk(child);
  }

  const observer = new MutationObserver((muts) => {
    if (!enabled) return;
    for (const m of muts) {
      for (const n of m.addedNodes) walk(n);
    }
  });

  function start() {
    walk(document.body);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- README / 长文本翻译 ----------
  // HF 模型卡 README 渲染在 .prose 容器；docs 等长文本页用 article/main 兜底
  const CACHE_PREFIX = "hfzh-readme:";
  let translating = false;

  function findProse() {
    return Array.from(document.querySelectorAll("[class~='prose']"))[0] || null;
  }

  function contentRoot() {
    return findProse()
      || document.querySelector("article")
      || document.querySelector("main");
  }

  // docs 正文容器自己也带 "prose" 类（prose-doc prose ...），无法靠类名区分，
  // 只能按路径判断：/docs 与 /blog 是长文本页，其余是模型卡 README
  function isReadme() {
    return !/^\/(docs|blog)(\/|$)/.test(location.pathname);
  }

  // 正文门槛：少于 800 字符视为无长文本（目录页/索引页/纯导航页），不注入按钮
  const MIN_TEXT = 800;

  function hasLongText(root) {
    if (!root) return false;
    if (root.hasAttribute("data-hfzh-orig")) return true;
    return root.innerText.replace(/\s+/g, " ").trim().length >= MIN_TEXT;
  }

  function label() {
    return isReadme() ? "翻译 README（AI）" : "翻译本页（AI）";
  }

  function injectTranslateButton() {
    const root = contentRoot();
    if (!root) return;
    const old = document.querySelector(".hfzh-btn");
    if (!hasLongText(root)) {
      if (old) old.remove();
      return;
    }
    if (root.querySelector(".hfzh-btn")) return;
    const btn = document.createElement("button");
    btn.className = "hfzh-btn";
    btn.textContent = label();
    btn.onclick = translateReadme;
    Object.assign(btn.style, {
      display: "inline-block",
      padding: "7px 14px", marginBottom: "10px", borderRadius: "8px", cursor: "pointer",
      border: "1px solid #d4d0c8", background: "#fff", color: "#191917",
      font: "600 13px system-ui", boxShadow: "0 1px 2px rgba(0,0,0,.08)",
    });
    const err = document.createElement("div");
    err.className = "hfzh-err";
    Object.assign(err.style, {
      display: "none", margin: "4px 0 10px", padding: "8px 12px", borderRadius: "8px",
      background: "rgba(179,55,43,.08)", color: "#B3372B", font: "12.5px system-ui",
    });
    root.prepend(err, btn);

    const cached = sessionStorage.getItem(cacheKey());
    if (cached) applyReadme(cached);
  }

  function cacheKey() {
    return CACHE_PREFIX + location.pathname;
  }

  function applyReadme(html) {
    const root = contentRoot();
    if (!root) return;
    if (!root.hasAttribute("data-hfzh-orig")) {
      root.setAttribute("data-hfzh-orig", root.innerHTML);
    }
    root.innerHTML = html;
    const btn = root.querySelector(".hfzh-btn");
    if (btn) {
      btn.textContent = "显示原文";
      btn.onclick = revertReadme;
      root.prepend(btn);
    }
    const err = document.querySelector(".hfzh-err");
    if (err) root.prepend(err);
  }

  function revertReadme() {
    const root = contentRoot();
    if (!root || !root.hasAttribute("data-hfzh-orig")) return;
    const orig = root.getAttribute("data-hfzh-orig");
    sessionStorage.removeItem(cacheKey());
    root.innerHTML = orig;
    const btn = root.querySelector(".hfzh-btn");
    if (btn) {
      btn.textContent = label();
      btn.onclick = translateReadme;
      root.prepend(btn);
    }
  }

  async function translateReadme() {
    if (translating) return;
    const root = contentRoot();
    const err = document.querySelector(".hfzh-err");
    if (err) err.style.display = "none";
    if (!root) return;

    // 已是译文 -> 切回原文
    if (root.hasAttribute("data-hfzh-orig")) return revertReadme();

    const cached = sessionStorage.getItem(cacheKey());
    if (cached) return applyReadme(cached);

    translating = true;
    const btn = root.querySelector(".hfzh-btn");
    if (btn) { btn.textContent = "翻译中…"; btn.disabled = true; }

    const rawText = root.innerText;
    try {
      const res = await chrome.runtime.sendMessage({
        type: "hfzh-translate",
        text: rawText,
        kind: isReadme() ? "readme" : "page",
      });
      if (!res || !res.ok) {
        if (err) {
          err.textContent = (res && res.error) || "翻译失败，请检查设置";
          err.style.display = "block";
          if (err && !root.contains(err)) root.prepend(err);
        }
        if (res && res.needConfig) chrome.runtime.sendMessage({ type: "hfzh-open-options" });
      } else {
        sessionStorage.setItem(cacheKey(), res.html);
        applyReadme(res.html);
      }
    } finally {
      translating = false;
      if (btn) { btn.textContent = label(); btn.disabled = false; }
    }
  }

  // SPA 路由变化时重新探测内容容器
  function watchReadme() {
    const mo = new MutationObserver(() => injectTranslateButton());
    mo.observe(document.body, { childList: true, subtree: true });
    injectTranslateButton();
  }

  function startCore() {
    walk(document.body);
    observer.observe(document.body, { childList: true, subtree: true });
    watchReadme();
    // SPA 首屏可能晚于 document_idle 才渲染，补一次兜底扫描
    setTimeout(() => { if (enabled) walk(document.body); }, 1200);
  }

  chrome.storage.local.get({ enabled: true, [DICT_KEY]: null }, (cfg) => {
    enabled = cfg.enabled;
    dict = cfg[DICT_KEY] || {};
    fetch(chrome.runtime.getURL("dict.json"))
      .then((r) => r.json())
      .then((bundled) => {
        const b = { ...bundled };
        delete b._v;
        if (enabled) {
          dict = { ...b, ...dict };
        } else {
          dict = b;
        }
        buildNorm();
        startCore();
      })
      .catch(() => {
        buildNorm();
        startCore();
      });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled) {
      enabled = changes.enabled.newValue;
      if (!enabled) revertAll();
      else walk(document.body);
    }
    if (changes[DICT_KEY]) {
      dict = changes[DICT_KEY].newValue || {};
      buildNorm();
      if (enabled) walk(document.body);
    }
  });
})();
