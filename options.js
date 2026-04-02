const ids = [
  "authorizeBaseUrl",
  "clientId",
  "scope",
  "backendExchangeUrl",
  "callbackPath",
];

const statusEl = document.getElementById("status");
const storedEl = document.getElementById("stored");
const redirectUriEl = document.getElementById("redirectUri");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#c62828" : "#387ced";
}

function getFormConfig() {
  const config = {};
  for (const id of ids) {
    config[id] = document.getElementById(id).value.trim();
  }
  return config;
}

function fillForm(config = {}) {
  for (const id of ids) {
    document.getElementById(id).value = config[id] || "";
  }
  const callbackPath = config.callbackPath || "openai-codex";
  redirectUriEl.textContent = chrome.identity.getRedirectURL(callbackPath);
}

async function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

async function refresh() {
  const configResp = await sendMessage({ type: "GET_CONFIG" });
  if (configResp?.error) {
    setStatus(configResp.error, true);
    return;
  }
  fillForm(configResp.config || {});

  const statusResp = await sendMessage({ type: "GET_STATUS" });
  if (statusResp?.error) {
    storedEl.textContent = statusResp.error;
    return;
  }
  storedEl.textContent = JSON.stringify(statusResp.data || {}, null, 2);
}

document.getElementById("save").onclick = async () => {
  const resp = await sendMessage({ type: "SAVE_CONFIG", config: getFormConfig() });
  if (resp?.ok) {
    setStatus("配置已保存");
    await refresh();
  } else {
    setStatus(resp?.error || "保存失败", true);
  }
};

document.getElementById("clear").onclick = async () => {
  const resp = await sendMessage({ type: "CLEAR_AUTH_DATA" });
  if (resp?.ok) {
    setStatus("已清空授权结果");
    await refresh();
  } else {
    setStatus(resp?.error || "清空失败", true);
  }
};

document.getElementById("reload-status").onclick = refresh;

for (const id of ids) {
  document.getElementById(id).addEventListener("input", () => {
    const callbackPath = document.getElementById("callbackPath").value.trim() || "openai-codex";
    redirectUriEl.textContent = chrome.identity.getRedirectURL(callbackPath);
  });
}

refresh();
