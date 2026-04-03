const statusEl = document.getElementById("status");
const detailsEl = document.getElementById("details");
const loginBtn = document.getElementById("login");
const optionsBtn = document.getElementById("open-options");

let pollTimer = null;
let currentFlowId = null;
let currentStatusUrl = null;
let currentAuth = null;
let currentMe = null;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#c62828" : "#387ced";
}

function setDetails(data) {
  detailsEl.textContent = data ? JSON.stringify(data, null, 2) : "";
}

function describeError(error) {
  if (!error) {
    return "unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object") {
    return error.message || error.code || JSON.stringify(error);
  }
  return String(error);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function getStoredState() {
  return await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, resolve);
  });
}

async function clearStoredAuth() {
  return await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "CLEAR_AUTH_DATA" }, resolve);
  });
}

async function fetchFlowStatus(statusUrl, flowId) {
  const url = new URL(statusUrl);
  url.searchParams.set("flowId", flowId);
  const response = await fetch(url.toString(), {
    method: "GET",
  });
  const rawText = await response.text();
  let parsed = {};
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { raw: rawText };
    }
  }
  return { response, parsed };
}

async function fetchMeInfo(meUrl, flowId) {
  const url = new URL(meUrl);
  url.searchParams.set("flowId", flowId);
  const response = await fetch(url.toString(), {
    method: "GET",
  });
  const rawText = await response.text();
  let parsed = {};
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { raw: rawText };
    }
  }
  return { response, parsed };
}

function renderFlowStatus(flow) {
  const phase = flow?.phase || "unknown";

  if (phase === "complete") {
    setStatus("✔ 后端授权已完成");
    return { done: true, isError: false };
  }

  if (phase === "failed") {
    setStatus(`❌ 授权失败：${describeError(flow?.error)}`, true);
    return { done: true, isError: true };
  }

  if (phase === "authorized" || phase === "exchanging") {
    setStatus("后端已收到回调，正在完成 token 交换...");
    return { done: false, isError: false };
  }

  if (phase === "pending") {
    setStatus("已打开授权页，等待用户完成登录...");
    return { done: false, isError: false };
  }

  setStatus(`当前状态：${phase}`);
  return { done: false, isError: false };
}

async function refreshViewFromBackend() {
  if (!currentFlowId || !currentStatusUrl) {
    return false;
  }

  const statusResult = await fetchFlowStatus(currentStatusUrl, currentFlowId);
  if (!statusResult.response.ok) {
    if (statusResult.response.status === 404) {
      setStatus("后端 flow 已过期或不存在", true);
      setDetails(statusResult.parsed);
      await clearStoredAuth();
      stopPolling();
      currentFlowId = null;
      currentStatusUrl = null;
      currentAuth = null;
      return true;
    }

    setStatus(`轮询 status 失败（HTTP ${statusResult.response.status}）`, true);
    setDetails(statusResult.parsed);
    return false;
  }

  const flow = statusResult.parsed;
  const renderResult = renderFlowStatus(flow);
  if (flow?.phase === "complete" && currentAuth?.meUrl) {
    const meResult = await fetchMeInfo(currentAuth.meUrl, currentFlowId);
    if (meResult.response.ok) {
      currentMe = meResult.parsed;
    } else {
      currentMe = {
        error: meResult.parsed?.error || `获取 /api/ext/me 失败（HTTP ${meResult.response.status}）`,
        response: meResult.parsed,
      };
    }
  }
  setDetails({
    auth: currentAuth,
    flow,
    me: currentMe,
    credentials: flow?.credentials || null,
  });

  if (renderResult.done) {
    stopPolling();
    if (renderResult.isError) {
      currentFlowId = null;
      currentStatusUrl = null;
      currentAuth = null;
    } else {
      currentFlowId = null;
      currentStatusUrl = null;
      currentAuth = null;
      currentMe = null;
    }
    return true;
  }

  return false;
}

async function startPolling() {
  stopPolling();
  if (!currentFlowId || !currentStatusUrl) {
    return;
  }

  const done = await refreshViewFromBackend();
  if (done || !currentFlowId || !currentStatusUrl) {
    return;
  }

  pollTimer = setInterval(() => {
    void refreshViewFromBackend().catch((error) => {
      setStatus(`轮询状态失败：${String(error?.message || error)}`, true);
    });
  }, 2000);
}

async function refreshStatus() {
  const resp = await getStoredState();
  if (resp?.error) {
    setStatus(`读取状态失败：${resp.error}`, true);
    return;
  }

  const auth = resp?.data?.oauth_last_auth;
  if (!auth?.authorizeUrl) {
    setStatus("尚未开始授权");
    setDetails(null);
    stopPolling();
    currentFlowId = null;
    currentStatusUrl = null;
    currentAuth = null;
    currentMe = null;
    return;
  }

  currentAuth = auth;
  currentFlowId = auth.flowId || null;
  currentStatusUrl = auth.statusUrl || null;
  currentMe = null;

  if (!currentFlowId || !currentStatusUrl) {
    setStatus("已保存授权 URL，但缺少 flow 信息");
    setDetails({ auth });
    return;
  }

  await startPolling();
}

loginBtn.onclick = async () => {
  setStatus("正在请求后端授权 URL...");
  setDetails(null);
  chrome.runtime.sendMessage({ type: "START_OAUTH" }, async (resp) => {
    if (resp?.ok) {
      currentAuth = resp.auth || null;
      currentFlowId = resp?.auth?.flowId || null;
      currentStatusUrl = resp?.auth?.statusUrl || null;
      currentMe = null;
      setStatus("已打开授权页，请在浏览器中完成登录");
      setDetails({
        auth: resp.auth || null,
      });
    } else {
      setStatus(`❌ 失败：${resp?.error || "未知错误"}`, true);
      setDetails(resp?.details || resp);
      stopPolling();
      currentFlowId = null;
      currentStatusUrl = null;
      currentAuth = null;
      currentMe = null;
    }
    await refreshStatus();
  });
};

optionsBtn.onclick = () => chrome.runtime.openOptionsPage();

refreshStatus();
