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
