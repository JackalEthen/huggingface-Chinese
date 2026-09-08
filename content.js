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

  function translateTextNode(node) {
    if (!node || !node.nodeValue) return;
    const raw = node.nodeValue;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const hit = lookup(trimmed);
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
        const hit = lookup(ph);
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
      const hit = lookup(title);
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

  // ---------- README 翻译 ----------
  // HF 模型卡 README 渲染在 .prose 容器（Svelte hydration 后存在）
  const CACHE_PREFIX = "hfzh-readme:";
  let translating = false;

  function injectTranslateButton() {
    const prose = document.querySelector(".prose");
    if (!prose || prose.querySelector(".hfzh-btn")) return;
    const btn = document.createElement("button");
    btn.className = "hfzh-btn";
    btn.textContent = "翻译 README（AI）";
    btn.onclick = translateReadme;
    Object.assign(btn.style, {
      position: "sticky", top: "8px", zIndex: "50", display: "inline-block",
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
    prose.prepend(err, btn);

    const cached = sessionStorage.getItem(cacheKey());
    if (cached) applyReadme(cached);
  }

  function cacheKey() {
    return CACHE_PREFIX + location.pathname;
  }

  function applyReadme(html) {
    const prose = document.querySelector(".prose");
    if (!prose) return;
    if (!prose.hasAttribute("data-hfzh-orig")) {
      prose.setAttribute("data-hfzh-orig", prose.innerHTML);
    }
    prose.innerHTML = html;
    const btn = prose.querySelector(".hfzh-btn");
    if (btn) {
      btn.textContent = "显示原文";
      btn.onclick = revertReadme;
      prose.prepend(btn);
    }
    const err = document.querySelector(".hfzh-err");
    if (err) prose.prepend(err);
  }

  function revertReadme() {
    const prose = document.querySelector(".prose");
    if (!prose || !prose.hasAttribute("data-hfzh-orig")) return;
    const orig = prose.getAttribute("data-hfzh-orig");
    sessionStorage.removeItem(cacheKey());
    prose.innerHTML = orig;
    const btn = prose.querySelector(".hfzh-btn");
    if (btn) {
      btn.textContent = "翻译 README（AI）";
      btn.onclick = translateReadme;
      prose.prepend(btn);
    }
  }

  async function translateReadme() {
    if (translating) return;
    const prose = document.querySelector(".prose");
    const err = document.querySelector(".hfzh-err");
    if (err) err.style.display = "none";
    if (!prose) return;

    // 已是译文 -> 切回原文
    if (prose.hasAttribute("data-hfzh-orig")) return revertReadme();

    const cached = sessionStorage.getItem(cacheKey());
    if (cached) return applyReadme(cached);

    translating = true;
    const btn = prose.querySelector(".hfzh-btn");
    if (btn) { btn.textContent = "翻译中…"; btn.disabled = true; }

    const rawText = prose.innerText;
    try {
      const res = await chrome.runtime.sendMessage({ type: "hfzh-translate", text: rawText });
      if (!res || !res.ok) {
        if (err) {
          err.textContent = (res && res.error) || "翻译失败，请检查设置";
          err.style.display = "block";
          if (err && !prose.contains(err)) prose.prepend(err);
        }
        if (res && res.needConfig) chrome.runtime.sendMessage({ type: "hfzh-open-options" });
      } else {
        sessionStorage.setItem(cacheKey(), res.html);
        applyReadme(res.html);
      }
    } finally {
      translating = false;
      if (btn) { btn.textContent = "翻译 README（AI）"; btn.disabled = false; }
    }
  }

  // SPA 路由变化时重新探测 README 容器
  function watchReadme() {
    const mo = new MutationObserver(() => injectTranslateButton());
    mo.observe(document.body, { childList: true, subtree: true });
    injectTranslateButton();
  }

  function startCore() {
    walk(document.body);
    observer.observe(document.body, { childList: true, subtree: true });
    watchReadme();
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
