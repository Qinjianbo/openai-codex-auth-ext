const statusEl = document.getElementById("status");
const detailsEl = document.getElementById("details");
const loginBtn = document.getElementById("login");
const optionsBtn = document.getElementById("open-options");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#c62828" : "#387ced";
}

function setDetails(data) {
  detailsEl.textContent = data ? JSON.stringify(data, null, 2) : "";
}

async function getStatus() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, resolve);
  });
}

async function refreshStatus() {
  const resp = await getStatus();
  if (resp?.error) {
    setStatus(`读取状态失败：${resp.error}`, true);
    return;
  }

  const exchange = resp?.data?.oauth_exchange_result;
  const auth = resp?.data?.oauth_last_auth;

  if (exchange?.ok) {
    setStatus(`✔ 已完成 code -> backend 交换（HTTP ${exchange.status}）`);
    setDetails(exchange);
    return;
  }

  if (exchange && !exchange.ok) {
    setStatus(`⚠ code 已拿到，但服务端交换失败（HTTP ${exchange.status}）`, true);
    setDetails(exchange);
    return;
  }

  if (auth?.authorizeUrl) {
    setStatus("已配置授权流程，尚未完成本次交换");
    setDetails({
      authorizeUrl: auth.authorizeUrl,
      redirectUri: auth.redirectUri,
      createdAt: auth.createdAt,
    });
    return;
  }

  setStatus("尚未开始授权");
  setDetails(null);
}

loginBtn.onclick = async () => {
  setStatus("正在打开授权页，请在浏览器中完成授权...");
  setDetails(null);
  chrome.runtime.sendMessage({ type: "START_OAUTH" }, async (resp) => {
    if (resp?.ok) {
      setStatus("✔ 已拿到 code，并已请求服务端交换");
      setDetails(resp.exchange || resp);
    } else {
      setStatus(`❌ 失败：${resp?.error || "未知错误"}`, true);
      setDetails(resp?.details || resp);
    }
    await refreshStatus();
  });
};

optionsBtn.onclick = () => chrome.runtime.openOptionsPage();

refreshStatus();
