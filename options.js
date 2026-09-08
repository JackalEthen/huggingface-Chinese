// options：API 配置 AES-GCM 加密存取 + 测试连接 + 词典状态
const PRESETS = {
  deepseek:   { url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  zhipu:      { url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  qwen:       { url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  openrouter: { url: "https://openrouter.ai/api/v1", model: "google/gemini-2.0-flash-001" },
  custom:     { url: "", model: "" },
};
const $ = (id) => document.getElementById(id);
const DICT_KEY = "hf-zh-dict";

function setStatus(el, cls, text) {
  el.className = "status " + cls + " show";
  el.querySelector("span:last-child").textContent = text;
}

// ---------- 设备密钥 + AES-GCM ----------
// ponytail: 密钥与密文同存 storage，防明文读取，不防完整磁盘控制者
async function getDevKey() {
  const { devKey } = await chrome.storage.local.get("devKey");
  if (devKey) return JSON.parse(devKey);
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const raw = JSON.stringify(jwk);
  await chrome.storage.local.set({ devKey: raw });
  return jwk;
}

async function encryptApiKey(plain) {
  const jwk = await getDevKey();
  const key = await crypto.subtle.importKey("jwk", jwk, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return {
    ct: btoa(String.fromCharCode(...new Uint8Array(ct))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

async function decryptApiKey(enc) {
  if (!enc || !enc.ct) return null;
  const jwk = await getDevKey();
  const key = await crypto.subtle.importKey("jwk", jwk, "AES-GCM", false, ["decrypt"]);
  const ct = Uint8Array.from(atob(enc.ct), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(enc.iv), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// ---------- 加载 ----------
async function load() {
  const { apiCfg } = await chrome.storage.local.get("apiCfg");
  $("ver").textContent = "v" + chrome.runtime.getManifest().version;

  // 词典统计
  const bundled = await (await fetch(chrome.runtime.getURL("dict.json"))).json();
  const local = (await chrome.storage.local.get(DICT_KEY))[DICT_KEY];
  const effective = local || bundled;
  $("bundled-count").textContent = Object.keys(bundled).filter((k) => k !== "_v").length;
  $("local-count").textContent = Object.keys(effective).filter((k) => k !== "_v").length;
  $("dict-ver").textContent = (effective && effective._v) || "内置";

  if (apiCfg) {
    $("baseurl").value = apiCfg.baseUrl || "";
    $("model").value = apiCfg.model || "";
    $("preset").value = matchPreset(apiCfg.baseUrl) || "custom";
    const key = await decryptApiKey(apiCfg.enc);
    $("apikey").value = key || "";
    setStatus($("status"), "ok", key ? "已配置 · 密钥已解密载入" : "已配置 · 密钥为空");
  }
}

function matchPreset(url) {
  for (const [k, p] of Object.entries(PRESETS)) {
    if (k !== "custom" && p.url && url && url.startsWith(p.url)) return k;
  }
  return null;
}

// ---------- 交互 ----------
$("preset").addEventListener("change", (e) => {
  const p = PRESETS[e.target.value];
  if (p && e.target.value !== "custom") {
    $("baseurl").value = p.url;
    $("model").value = p.model;
  }
});

$("save").addEventListener("click", async () => {
  const baseUrl = $("baseurl").value.trim();
  const model = $("model").value.trim();
  const apiKey = $("apikey").value.trim();
  if (!baseUrl || !model) {
    setStatus($("status"), "err", "接口地址和模型不能为空");
    return;
  }
  const enc = apiKey ? await encryptApiKey(apiKey) : null;
  await chrome.storage.local.set({ apiCfg: { baseUrl, model, enc } });
  setStatus($("status"), "ok", "已保存（密钥 AES-GCM 加密存储）");
});

$("test").addEventListener("click", async () => {
  const baseUrl = $("baseurl").value.trim().replace(/\/$/, "");
  const model = $("model").value.trim();
  const apiKey = $("apikey").value.trim();
  const st = $("status");
  if (!baseUrl || !model || !apiKey) {
    setStatus(st, "err", "请先完整填写地址、模型和 API Key");
    return;
  }
  setStatus(st, "pending", "连接中…");
  try {
    // 确保目标域在 host_permissions（MV3 动态注入不适用于 fetch，需声明或授权）
    const r = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      }),
    });
    if (r.ok) setStatus(st, "ok", "连接成功 · 模型可用");
    else if (r.status === 401) setStatus(st, "err", "401：API Key 无效");
    else if (r.status === 404) setStatus(st, "err", "404：接口地址或模型名错误");
    else setStatus(st, "err", "HTTP " + r.status + "：" + (await r.text()).slice(0, 80));
  } catch (e) {
    setStatus(st, "err", "网络错误：" + (e && e.message || e) + "（可能需在 manifest 添加该域权限）");
  }
});

$("check-update").addEventListener("click", async () => {
  const st = $("dict-status");
  setStatus(st, "pending", "检查中…");
  const before = (await chrome.storage.local.get(DICT_KEY))[DICT_KEY];
  const beforeV = (before && before._v) || "";
  await chrome.runtime.sendMessage({ type: "hfzh-update-dict" });
  await new Promise((r) => setTimeout(r, 1500));
  const after = (await chrome.storage.local.get(DICT_KEY))[DICT_KEY];
  const afterV = (after && after._v) || "";
  if (afterV > beforeV) {
    setStatus(st, "ok", "已更新到 " + afterV);
    $("local-count").textContent = Object.keys(after).filter((k) => k !== "_v").length;
    $("dict-ver").textContent = afterV;
  } else {
    setStatus(st, "ok", "已是最新版本 " + (afterV || "内置"));
  }
});

load();
