// 后台：词典静默更新（jsDelivr 主源 + raw 兜底 + 版本比对）+ LLM 翻译桥
// ponytail: 每次唤醒拉一次，无定时调度，词典更新靠访问页面触发
const DICT_KEY = "hf-zh-dict";
const REPO = "JackalEthen/huggingface-Chinese";
const SOURCES = [
  `https://cdn.jsdelivr.net/gh/${REPO}@main/dict.json`,
  `https://raw.githubusercontent.com/${REPO}/main/dict.json`,
];

chrome.runtime.onInstalled.addListener(fetchRemote);
chrome.runtime.onStartup.addListener(fetchRemote);
chrome.runtime.onMessage.addListener(onMessage);

// options 页主动触发（手动检查更新）
async function fetchRemote() {
  for (const url of SOURCES) {
    try {
      const r = await fetch(url + "?t=" + Date.now());
      if (!r.ok) continue;
      const remote = await r.json();
      if (remote && typeof remote === "object" && Object.keys(remote).length) {
        const cur = (await chrome.storage.local.get(DICT_KEY))[DICT_KEY];
        const curV = (cur && cur._v) || "";
        if (remote._v && remote._v > curV) {
          await chrome.storage.local.set({ [DICT_KEY]: remote });
        }
        return;
      }
    } catch { /* 换下一个源 */ }
  }
}

async function onMessage(msg, sender, sendResponse) {
  if (msg.type === "hfzh-update-dict") {
    fetchRemote();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === "hfzh-open-options") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === "hfzh-translate") {
    translateReadme(msg.text, sender, msg.kind)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true; // async
  }
}

// ---------- LLM 翻译 ----------
async function getApiKey() {
  const { enc } = await chrome.storage.local.get("apiCfg");
  if (!enc || !enc.ct) return null;
  const { devKey } = await chrome.storage.local.get("devKey");
  if (!devKey) return null;
  // ponytail: 设备密钥 AES-GCM，防存储文件明文读取，不防完整磁盘控制者
  const key = await crypto.subtle.importKey("jwk", JSON.parse(devKey), "AES-GCM", false, ["decrypt"]);
  const ct = Uint8Array.from(atob(enc.ct), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(enc.iv), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

async function translateReadme(text, sender, kind) {
  const cfg = (await chrome.storage.local.get("apiCfg")).apiCfg;
  const apiKey = await getApiKey();
  if (!cfg || !cfg.baseUrl || !apiKey) {
    // 从 content 发起时直接跳设置页
    if (sender.tab) chrome.tabs.sendMessage(sender.tab.id, { type: "hfzh-need-config" }).catch?.(() => {});
    return { ok: false, needConfig: true, error: "未配置 API" };
  }
  const src = kind === "readme" ? "Hugging Face 模型卡 README" : "Hugging Face 技术文档页面";
  const prompt =
    "你是专业翻译。将下面的" + src + "英文内容翻译成简体中文，" +
    "保留所有 Markdown 结构（标题/列表/表格/代码块/链接/图片），代码块内代码不翻译，" +
    "专有名词（模型名、库名、函数名、API 名）保留原文。只输出翻译后的 Markdown，不要解释。\n\n" + text;
  try {
    const r = await fetch(cfg.baseUrl.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { ok: false, error: `API ${r.status}：${body.slice(0, 120)}` };
    }
    const data = await r.json();
    const out = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!out) return { ok: false, error: "API 返回为空" };
    return { ok: true, html: mdToHtml(out) };
  } catch (e) {
    return { ok: false, error: "网络错误：" + (e && e.message || e) };
  }
}

// ponytail: LLM 输出 Markdown，转 HTML 用正则最小实现（标题/粗体/代码/列表/段落），
// 富表格等复杂结构退化为纯文本段落，够用；要完美渲染再引入 marked
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mdToHtml(md) {
  const lines = md.split("\n");
  const out = [];
  let inCode = false, inList = false, codeBuf = [], paraBuf = [];

  const flushPara = () => {
    if (paraBuf.length) {
      out.push("<p>" + paraBuf.join("<br>") + "</p>");
      paraBuf = [];
    }
  };
  const flushList = () => {
    if (inList) { out.push("</ul>"); inList = false; }
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flushPara(); flushList();
      if (inCode) { out.push("<pre><code>" + esc(codeBuf.join("\n")) + "</code></pre>"); codeBuf = []; inCode = false; }
      else inCode = true;
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      flushPara(); flushList();
      const n = h[1].length;
      out.push(`<h${n}>` + inline(h[2]) + `</h${n}>`);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) {
      flushPara();
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push("<li>" + inline(li[1]) + "</li>");
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    // 表格行照原样降级为段落文本
    paraBuf.push(inline(line));
  }
  if (inCode) out.push("<pre><code>" + esc(codeBuf.join("\n")) + "</code></pre>");
  flushPara(); flushList();
  return out.join("\n");
}

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">');
}

// ---------- 会话密钥协商（content -> background）----------
// content 无法读 storage 里的加密 key，统一走 sendMessage，无额外暴露面
