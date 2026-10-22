const DICT_KEY = "hf-zh-dict";
const $ = (id) => document.getElementById(id);

chrome.storage.local.get({ enabled: true, [DICT_KEY]: null }, (cfg) => {
  $("toggle").checked = cfg.enabled;
  document.body.classList.toggle("off", !cfg.enabled);
  const d = cfg[DICT_KEY];
  if (d) {
    $("dict-count").textContent = Object.keys(d).filter((k) => k !== "_v").length;
    $("dict-ver").textContent = (d._v || "").slice(5) || "内置";
  } else {
    fetch(chrome.runtime.getURL("dict.json"))
      .then((r) => r.json())
      .then((b) => {
        $("dict-count").textContent = Object.keys(b).filter((k) => k !== "_v").length;
        $("dict-ver").textContent = "内置";
      });
  }
});

$("toggle").addEventListener("change", () => {
  const on = $("toggle").checked;
  document.body.classList.toggle("off", !on);
  chrome.storage.local.set({ enabled: on });
});

$("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

// 检查更新：复用 background 的词典拉取，比对 _v 后原地反馈
$("check-update").addEventListener("click", async () => {
  const btn = $("check-update");
  const msg = $("update-msg");
  btn.disabled = true;
  msg.className = "update-msg";
  msg.textContent = "检查中…";
  const beforeV = ((await chrome.storage.local.get(DICT_KEY))[DICT_KEY] || {})._v || "";
  await chrome.runtime.sendMessage({ type: "hfzh-update-dict" });
  await new Promise((r) => setTimeout(r, 1500));
  const after = (await chrome.storage.local.get(DICT_KEY))[DICT_KEY] || {};
  const afterV = after._v || "";
  if (afterV > beforeV) {
    msg.className = "update-msg ok";
    msg.textContent = "已更新到 " + afterV;
    $("dict-count").textContent = Object.keys(after).filter((k) => k !== "_v").length;
    $("dict-ver").textContent = afterV.slice(5);
  } else {
    msg.className = "update-msg ok";
    msg.textContent = "已是最新版本 " + (afterV || "内置");
  }
  btn.disabled = false;
});
