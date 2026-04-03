const DEFAULT_CONFIG = {
  backendBaseUrl: "http://localhost:8080/api/ext/oauth",
  scope: "openid profile email offline_access",
};

async function getConfig() {
  const stored = await chrome.storage.local.get(["oauth_config"]);
  return {
    ...DEFAULT_CONFIG,
    ...(stored.oauth_config || {}),
  };
}

function joinUrl(baseUrl, suffix) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(suffix.replace(/^\/+/, ""), normalizedBase).toString();
}

async function requestJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
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

async function openTab(url) {
  return await new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: true }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || "Failed to open tab"));
        return;
      }
      resolve(tab);
    });
  });
}

async function saveAuthState(payload) {
  await chrome.storage.local.set({ oauth_last_auth: payload });
}

async function clearAuthData() {
  await chrome.storage.local.remove([
    "oauth_last_auth",
    "oauth_exchange_result",
    "oauth_flow_status",
    "oauth_flow_poll",
  ]);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_CONFIG") {
    getConfig()
      .then((config) => sendResponse({ config }))
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }

  if (msg.type === "SAVE_CONFIG") {
    chrome.storage.local
      .set({ oauth_config: msg.config || {} })
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }

  if (msg.type === "GET_STATUS") {
    chrome.storage.local
      .get(["oauth_last_auth", "oauth_config"])
      .then((data) => {
        sendResponse({ data });
      })
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }

  if (msg.type === "CLEAR_AUTH_DATA") {
    clearAuthData()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }

  if (msg.type === "START_OAUTH") {
    (async () => {
      const config = await getConfig();
      if (!config.backendBaseUrl) {
        sendResponse({ error: "请先在设置页填写 backendBaseUrl" });
        return;
      }

      const startUrl = joinUrl(config.backendBaseUrl, "start");
      const statusUrl = joinUrl(config.backendBaseUrl, "status");
      const scope = config.scope || DEFAULT_CONFIG.scope;

      const startResult = await requestJson(startUrl, {
        provider: "openai-codex",
        scope,
      });

      if (!startResult.response.ok) {
        sendResponse({
          error: startResult.parsed?.error || `后端 start 失败 (${startResult.response.status})`,
          details: {
            request: {
              url: startUrl,
              provider: "openai-codex",
              scope,
            },
            response: startResult.parsed,
          },
        });
        return;
      }

      const authorizeUrl = startResult.parsed?.authorizeUrl;
      if (typeof authorizeUrl !== "string" || !authorizeUrl) {
        sendResponse({
          error: "后端 start 响应缺少 authorizeUrl",
          details: startResult.parsed,
        });
        return;
      }

      const authState = {
        createdAt: Date.now(),
        provider: "openai-codex",
        startUrl,
        statusUrl,
        authorizeUrl,
        callbackUrl: typeof startResult.parsed?.callbackUrl === "string" ? startResult.parsed.callbackUrl : null,
        flowId: typeof startResult.parsed?.flowId === "string" ? startResult.parsed.flowId : null,
        state: typeof startResult.parsed?.state === "string" ? startResult.parsed.state : null,
        scope,
      };

      await saveAuthState(authState);

      await openTab(authorizeUrl);

      sendResponse({
        ok: true,
        auth: authState,
      });
    })().catch((error) => {
      sendResponse({ error: String(error?.message || error) });
    });
    return true;
  }
});
