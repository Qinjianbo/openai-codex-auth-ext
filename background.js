const DEFAULT_CONFIG = {
  authorizeBaseUrl: "https://auth.openai.com/oauth/authorize",
  clientId: "",
  scope: "openid profile email offline_access",
  backendExchangeUrl: "http://localhost:8080/api/ext/oauth/exchange",
  callbackPath: "openai-codex",
};

function base64UrlEncode(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomString(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256Base64Url(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

async function getConfig() {
  const stored = await chrome.storage.local.get(["oauth_config"]);
  return {
    ...DEFAULT_CONFIG,
    ...(stored.oauth_config || {}),
  };
}

async function saveAuthState(payload) {
  await chrome.storage.local.set({ oauth_last_auth: payload });
}

async function saveExchangeResult(payload) {
  await chrome.storage.local.set({ oauth_exchange_result: payload });
}

async function clearAuthData() {
  await chrome.storage.local.remove(["oauth_last_auth", "oauth_exchange_result"]);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_CONFIG") {
    getConfig().then((config) => sendResponse({ config })).catch((error) => {
      sendResponse({ error: String(error?.message || error) });
    });
    return true;
  }

  if (msg.type === "SAVE_CONFIG") {
    chrome.storage.local.set({ oauth_config: msg.config || {} }).then(() => {
      sendResponse({ ok: true });
    }).catch((error) => {
      sendResponse({ error: String(error?.message || error) });
    });
    return true;
  }

  if (msg.type === "GET_STATUS") {
    chrome.storage.local.get(["oauth_last_auth", "oauth_exchange_result", "oauth_config"]).then((data) => {
      sendResponse({ data });
    }).catch((error) => {
      sendResponse({ error: String(error?.message || error) });
    });
    return true;
  }

  if (msg.type === "CLEAR_AUTH_DATA") {
    clearAuthData().then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ error: String(error?.message || error) });
    });
    return true;
  }

  if (msg.type === "START_OAUTH") {
    (async () => {
      const config = await getConfig();
      if (!config.clientId) {
        sendResponse({ error: "请先在设置页填写 clientId" });
        return;
      }
      if (!config.backendExchangeUrl) {
        sendResponse({ error: "请先在设置页填写 backendExchangeUrl" });
        return;
      }

      const redirectUri = chrome.identity.getRedirectURL(config.callbackPath || DEFAULT_CONFIG.callbackPath);
      const state = randomString(24);
      const codeVerifier = randomString(48);
      const codeChallenge = await sha256Base64Url(codeVerifier);

      const authorizeUrl = new URL(config.authorizeBaseUrl || DEFAULT_CONFIG.authorizeBaseUrl);
      authorizeUrl.searchParams.set("client_id", config.clientId);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("scope", config.scope || DEFAULT_CONFIG.scope);
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("code_challenge", codeChallenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");

      await saveAuthState({
        createdAt: Date.now(),
        authorizeUrl: authorizeUrl.toString(),
        redirectUri,
        state,
        codeVerifier,
      });

      chrome.identity.launchWebAuthFlow({
        url: authorizeUrl.toString(),
        interactive: true,
      }, async (redirectedTo) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message || "launchWebAuthFlow failed" });
          return;
        }
        if (!redirectedTo) {
          sendResponse({ error: "未收到回调地址，可能是用户取消了授权" });
          return;
        }

        try {
          const redirectedUrl = new URL(redirectedTo);
          const code = redirectedUrl.searchParams.get("code");
          const returnedState = redirectedUrl.searchParams.get("state");
          const oauthError = redirectedUrl.searchParams.get("error");
          const oauthErrorDescription = redirectedUrl.searchParams.get("error_description");

          if (oauthError) {
            sendResponse({ error: `${oauthError}${oauthErrorDescription ? `: ${oauthErrorDescription}` : ""}` });
            return;
          }
          if (!code) {
            sendResponse({ error: "回调中没有 code" });
            return;
          }
          if (returnedState !== state) {
            sendResponse({ error: "state 校验失败" });
            return;
          }

          const exchangePayload = {
            provider: "openai-codex",
            code,
            state,
            redirectUri,
            codeVerifier,
            clientId: config.clientId,
            scope: config.scope || DEFAULT_CONFIG.scope,
          };

          const exchangeResp = await fetch(config.backendExchangeUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(exchangePayload),
          });

          const rawText = await exchangeResp.text();
          let parsed;
          try {
            parsed = rawText ? JSON.parse(rawText) : {};
          } catch {
            parsed = { raw: rawText };
          }

          const result = {
            requestedAt: Date.now(),
            ok: exchangeResp.ok,
            status: exchangeResp.status,
            request: {
              provider: exchangePayload.provider,
              redirectUri: exchangePayload.redirectUri,
              clientId: exchangePayload.clientId,
              scope: exchangePayload.scope,
              codePreview: `${code.slice(0, 6)}...`,
            },
            response: parsed,
          };

          await saveExchangeResult(result);

          if (!exchangeResp.ok) {
            sendResponse({ error: parsed?.error || `服务端交换失败(${exchangeResp.status})`, details: result });
            return;
          }

          sendResponse({ ok: true, code, exchange: result });
        } catch (error) {
          sendResponse({ error: String(error?.message || error) });
        }
      });
    })().catch((error) => {
      sendResponse({ error: String(error?.message || error) });
    });
    return true;
  }
});
