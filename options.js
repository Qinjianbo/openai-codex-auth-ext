const ids = ["backendBaseUrl", "scope"];

const statusEl = document.getElementById("status");
const storedEl = document.getElementById("stored");
const callbackUrlEl = document.getElementById("callbackUrl");
const backendUrlsEl = document.getElementById("backendUrls");

const DEFAULT_BACKEND_BASE_URL = "http://localhost:8080/api/ext/oauth";
const DEFAULT_CALLBACK_URL = "http://localhost:1455/auth/callback";

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#c62828" : "#387ced";
}

function joinUrl(baseUrl, suffix) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(suffix.replace(/^\/+/, ""), normalizedBase).toString();
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

  const backendBaseUrl = config.backendBaseUrl || DEFAULT_BACKEND_BASE_URL;
  callbackUrlEl.textContent = DEFAULT_CALLBACK_URL;
  backendUrlsEl.textContent = JSON.stringify(
    {
      start: joinUrl(backendBaseUrl, "start"),
      status: joinUrl(backendBaseUrl, "status"),
      me: joinUrl(backendBaseUrl, "me"),
    },
    null,
    2,
  );
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
    const backendBaseUrl =
      document.getElementById("backendBaseUrl").value.trim() || DEFAULT_BACKEND_BASE_URL;
    callbackUrlEl.textContent = DEFAULT_CALLBACK_URL;
    backendUrlsEl.textContent = JSON.stringify(
      {
        start: joinUrl(backendBaseUrl, "start"),
        status: joinUrl(backendBaseUrl, "status"),
        me: joinUrl(backendBaseUrl, "me"),
      },
      null,
      2,
    );
  });
}

refresh();
