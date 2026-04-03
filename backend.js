#!/usr/bin/env node

const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");

const DEFAULTS = {
  host: process.env.OPENAI_CODEX_BACKEND_HOST || "127.0.0.1",
  port: Number(process.env.OPENAI_CODEX_BACKEND_PORT || 8080),
  callbackHost: process.env.OPENAI_CODEX_CALLBACK_HOST || "localhost",
  callbackPort: Number(process.env.OPENAI_CODEX_CALLBACK_PORT || 1455),
  authorizeUrl: process.env.OPENAI_CODEX_AUTHORIZE_URL || "https://auth.openai.com/oauth/authorize",
  tokenUrl: process.env.OPENAI_CODEX_TOKEN_URL || "https://auth.openai.com/oauth/token",
  clientId: process.env.OPENAI_CODEX_CLIENT_ID || "app_EMoamEEZ73f0CkXaXp7hrann",
  originator: process.env.OPENAI_CODEX_ORIGINATOR || "pi",
  flowTtlMs: Number(process.env.OPENAI_CODEX_FLOW_TTL_MS || 10 * 60 * 1000),
};

const flows = new Map();

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

function createPkcePair() {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res, statusCode, title, message) {
  const body = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: sans-serif; padding: 24px;">
  <h1>${title}</h1>
  <p>${message}</p>
  <p>You can close this tab.</p>
</body>
</html>`;
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end(text);
}

function formatOAuthError(error) {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const code = typeof error.code === "string" ? error.code : "";
    const message = typeof error.message === "string" ? error.message : "";
    const type = typeof error.type === "string" ? error.type : "";
    const parts = [code, message, type].filter((part) => part.trim());
    if (parts.length > 0) {
      return parts.join(": ");
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown OAuth error";
    }
  }
  return error ? String(error) : "";
}

function createProxyAgent(protocol) {
  const hasProxyEnv =
    process.env.NODE_USE_ENV_PROXY === "1" ||
    Boolean(
      process.env.HTTP_PROXY ||
        process.env.HTTPS_PROXY ||
        process.env.http_proxy ||
        process.env.https_proxy ||
        process.env.ALL_PROXY ||
        process.env.all_proxy,
    );

  if (!hasProxyEnv) {
    return null;
  }

  if (protocol === "https:") {
    return new https.Agent({ proxyEnv: process.env });
  }

  return new http.Agent({ proxyEnv: process.env });
}

function describeProxyMode() {
  const proxyEntries = [
    ["HTTP_PROXY", process.env.HTTP_PROXY || process.env.http_proxy],
    ["HTTPS_PROXY", process.env.HTTPS_PROXY || process.env.https_proxy],
    ["ALL_PROXY", process.env.ALL_PROXY || process.env.all_proxy],
  ];
  const noProxyValue = process.env.NO_PROXY || process.env.no_proxy;
  const useEnvProxyValue = process.env.NODE_USE_ENV_PROXY;

  const enabled = Boolean(useEnvProxyValue) || proxyEntries.some(([, value]) => Boolean(value));
  const summary = [
    ...(useEnvProxyValue ? ["NODE_USE_ENV_PROXY"] : []),
    ...proxyEntries.filter(([, value]) => Boolean(value)).map(([name]) => name),
    ...(noProxyValue ? ["NO_PROXY"] : []),
  ].join(", ");

  return {
    enabled,
    summary: summary || "none",
  };
}

async function requestJsonWithProxy(urlString, options = {}) {
  const url = new URL(urlString);
  const client = url.protocol === "https:" ? https : http;
  const agent = createProxyAgent(url.protocol);
  const method = options.method || "GET";
  const headers = { ...(options.headers || {}) };
  const body = options.body ?? null;
  const bodyText = body == null ? null : typeof body === "string" ? body : JSON.stringify(body);

  if (bodyText && !headers["Content-Length"] && !headers["content-length"]) {
    headers["Content-Length"] = Buffer.byteLength(bodyText);
  }

  return await new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        agent: agent || undefined,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          const rawText = Buffer.concat(chunks).toString("utf8");
          let parsed = {};
          if (rawText) {
            try {
              parsed = JSON.parse(rawText);
            } catch {
              parsed = { raw: rawText };
            }
          }
          resolve({
            ok: res.statusCode ? res.statusCode >= 200 && res.statusCode < 300 : false,
            status: res.statusCode || 0,
            parsed,
          });
        });
      },
    );

    req.on("error", reject);
    if (bodyText) {
      req.write(bodyText);
    }
    req.end();
  });
}

async function requestFormUrlEncoded(urlString, formBody) {
  return await requestJsonWithProxy(urlString, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody.toString(),
  });
}

function getJwtAccountId(accessToken) {
  try {
    const parts = String(accessToken || "").split(".");
    if (parts.length !== 3) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const auth = payload?.["https://api.openai.com/auth"];
    const accountId = auth?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.trim() ? accountId : null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) {
      return null;
    }
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

async function fetchOpenAIProfile(accessToken) {
  const response = await requestJsonWithProxy("https://api.openai.com/v1/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  console.log(
    `[openai-codex-backend] /v1/me status=${response.status} ok=${response.ok} body=${safeJsonStringify(response.parsed)}`,
  );

  return response;
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function normalizeOpenAIProfile(flow, meResponse) {
  const accessPayload = decodeJwtPayload(flow.credentials?.access);
  const idPayload = decodeJwtPayload(flow.credentials?.idToken);
  const apiUser = meResponse?.parsed?.user || {};
  const apiOrgs = Array.isArray(meResponse?.parsed?.orgs?.data) ? meResponse.parsed.orgs.data : [];
  const auth = accessPayload?.["https://api.openai.com/auth"] || {};
  const profile = accessPayload?.["https://api.openai.com/profile"] || {};

  const userId =
    typeof apiUser.id === "string" && apiUser.id
      ? apiUser.id
      : typeof auth.chatgpt_user_id === "string"
        ? auth.chatgpt_user_id
        : typeof auth.user_id === "string"
          ? auth.user_id
          : null;

  const email =
    typeof apiUser.email === "string" && apiUser.email
      ? apiUser.email
      : typeof profile.email === "string"
        ? profile.email
        : typeof idPayload?.email === "string"
          ? idPayload.email
          : null;

  const name =
    typeof apiUser.name === "string" && apiUser.name
      ? apiUser.name
      : typeof idPayload?.name === "string"
        ? idPayload.name
        : null;

  const idp =
    typeof idPayload?.auth_provider === "string"
      ? idPayload.auth_provider
      : typeof auth.auth_provider === "string"
        ? auth.auth_provider
        : null;

  const accountId =
    typeof auth.chatgpt_account_id === "string"
      ? auth.chatgpt_account_id
      : typeof meResponse?.parsed?.account?.id === "string"
        ? meResponse.parsed.account.id
        : flow.credentials?.accountId || null;

  return {
    ok: true,
    flowId: flow.flowId,
    provider: flow.provider,
    expires: flow.credentials?.expires ? new Date(flow.credentials.expires).toISOString() : null,
    user: {
      id: userId,
      name,
      email,
      idp,
      iat: typeof idPayload?.iat === "number" ? idPayload.iat : null,
      mfa: Boolean(idPayload?.mfa ?? apiUser.mfa ?? false),
    },
    account: {
      id: accountId,
      planType:
        typeof auth.chatgpt_plan_type === "string"
          ? auth.chatgpt_plan_type
          : typeof meResponse?.parsed?.account?.planType === "string"
            ? meResponse.parsed.account.planType
            : null,
      structure:
        typeof meResponse?.parsed?.account?.structure === "string"
          ? meResponse.parsed.account.structure
          : apiOrgs.length > 0
            ? "personal"
            : null,
      residencyRegion:
        typeof auth.chatgpt_compute_residency === "string"
          ? auth.chatgpt_compute_residency
          : typeof meResponse?.parsed?.account?.residencyRegion === "string"
            ? meResponse.parsed.account.residencyRegion
            : null,
      computeResidency:
        typeof auth.chatgpt_compute_residency === "string"
          ? auth.chatgpt_compute_residency
          : typeof meResponse?.parsed?.account?.computeResidency === "string"
            ? meResponse.parsed.account.computeResidency
            : null,
    },
    orgs: apiOrgs
      .map((org) => ({
        id: typeof org.id === "string" ? org.id : null,
        title: typeof org.title === "string" ? org.title : null,
        role: typeof org.role === "string" ? org.role : null,
        isDefault: Boolean(org.is_default),
      }))
      .filter((org) => org.id || org.title),
    sources: {
      v1Me: Boolean(meResponse?.ok),
      tokenClaims: true,
    },
  };
}

function cleanupExpiredFlows() {
  const now = Date.now();
  for (const [flowId, flow] of flows.entries()) {
    if (now - flow.createdAt > DEFAULTS.flowTtlMs) {
      flows.delete(flowId);
    }
  }
}

function buildAuthorizeUrl({ redirectUri, scope, state, challenge }) {
  const url = new URL(DEFAULTS.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", DEFAULTS.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scope);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", DEFAULTS.originator);
  return url.toString();
}

async function exchangeFlowCode(flow) {
  flow.phase = "exchanging";
  const proxyMode = describeProxyMode();
  console.log(
    `[openai-codex-backend] token exchange ${proxyMode.enabled ? "with" : "without"} proxy (${proxyMode.summary})`,
  );
  const response = await requestFormUrlEncoded(
    DEFAULTS.tokenUrl,
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: DEFAULTS.clientId,
      code: flow.code,
      code_verifier: flow.verifier,
      redirect_uri: flow.callbackUrl,
    }),
  );

  if (!response.ok) {
    flow.phase = "failed";
    flow.error =
      formatOAuthError(response.parsed?.error) || `Token exchange failed (${response.status})`;
    flow.exchangeStatus = response.status;
    flow.exchangeResponse = response.parsed;
    return;
  }

  const access = response.parsed.access_token;
  const refresh = response.parsed.refresh_token;
  const expiresIn = response.parsed.expires_in;
  if (typeof access !== "string" || typeof refresh !== "string" || typeof expiresIn !== "number") {
    flow.phase = "failed";
    flow.error = "Token response missing required fields";
    flow.exchangeStatus = 502;
    flow.exchangeResponse = response.parsed;
    return;
  }

  flow.phase = "complete";
  flow.exchangeStatus = response.status;
  flow.exchangeResponse = response.parsed;
  flow.credentials = {
    type: "oauth",
    provider: "openai-codex",
    access,
    refresh,
    expires: Date.now() + expiresIn * 1000,
    accountId: getJwtAccountId(access) || undefined,
    idToken: typeof response.parsed.id_token === "string" ? response.parsed.id_token : undefined,
    scope: typeof response.parsed.scope === "string" ? response.parsed.scope : undefined,
    tokenType:
      typeof response.parsed.token_type === "string" ? response.parsed.token_type : undefined,
  };
}

function flowSummary(flowId, flow) {
  return {
    ok: true,
    flowId,
    provider: flow.provider,
    phase: flow.phase,
    state: flow.state,
    callbackUrl: flow.callbackUrl,
    authorizeUrl: flow.authorizeUrl,
    scope: flow.scope,
    createdAt: flow.createdAt,
    expiresAt: flow.createdAt + DEFAULTS.flowTtlMs,
    codeReceived: Boolean(flow.code),
    exchangeStatus: flow.exchangeStatus,
    error: flow.error,
    credentials: flow.credentials || null,
  };
}

const callbackServer = http.createServer((req, res) => {
  const requestUrl = new URL(
    req.url || "/",
    `http://${req.headers.host || `${DEFAULTS.callbackHost}:${DEFAULTS.callbackPort}`}`,
  );

  if (req.method !== "GET" || requestUrl.pathname !== "/auth/callback") {
    sendText(res, 404, "Not found");
    return;
  }

  cleanupExpiredFlows();

  const oauthError = requestUrl.searchParams.get("error");
  const oauthErrorDescription = requestUrl.searchParams.get("error_description");
  const state = requestUrl.searchParams.get("state");
  const code = requestUrl.searchParams.get("code");

  let flow = null;
  if (state) {
    for (const candidate of flows.values()) {
      if (candidate.state === state) {
        flow = candidate;
        break;
      }
    }
  }

  if (!flow) {
    sendHtml(res, 400, "OpenAI Codex OAuth", "No matching OAuth flow was found.");
    return;
  }

  if (oauthError) {
    flow.phase = "failed";
    flow.error = `${oauthError}${oauthErrorDescription ? `: ${oauthErrorDescription}` : ""}`;
    sendHtml(res, 400, "OpenAI Codex OAuth", `Authorization failed: ${flow.error}`);
    return;
  }

  if (!code) {
    flow.phase = "failed";
    flow.error = "Missing authorization code";
    sendHtml(res, 400, "OpenAI Codex OAuth", flow.error);
    return;
  }

  if (state !== flow.state) {
    flow.phase = "failed";
    flow.error = "State mismatch";
    sendHtml(res, 400, "OpenAI Codex OAuth", flow.error);
    return;
  }

  flow.code = code;
  flow.phase = "authorized";
  sendHtml(res, 200, "OpenAI Codex OAuth", "Authorization received. Completing exchange...");

  void exchangeFlowCode(flow).catch((error) => {
    flow.phase = "failed";
    flow.error = String(error?.message || error);
  });
});

const mainServer = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${DEFAULTS.host}:${DEFAULTS.port}`}`);

  if (req.method === "GET" && requestUrl.pathname === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/ext/oauth/status") {
    cleanupExpiredFlows();
    const flowId = requestUrl.searchParams.get("flowId");
    if (!flowId) {
      sendJson(res, 400, { error: "flowId is required" });
      return;
    }

    const flow = flows.get(flowId);
    if (!flow) {
      sendJson(res, 404, { error: "Unknown or expired flowId" });
      return;
    }

    sendJson(res, 200, flowSummary(flowId, flow));
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/ext/me") {
    cleanupExpiredFlows();
    const flowId = requestUrl.searchParams.get("flowId");
    if (!flowId) {
      sendJson(res, 400, { error: "flowId is required" });
      return;
    }

    const flow = flows.get(flowId);
    if (!flow) {
      sendJson(res, 404, { error: "Unknown or expired flowId" });
      return;
    }

    const accessToken = flow.credentials?.access;
    if (typeof accessToken !== "string" || !accessToken) {
      sendJson(res, 409, { error: "No access token available for this flow" });
      return;
    }

    const meResponse = await fetchOpenAIProfile(accessToken);
    if (!meResponse.ok) {
      console.log(
        `[openai-codex-backend] /api/ext/me failed flowId=${flowId} status=${meResponse.status} body=${safeJsonStringify(meResponse.parsed)}`,
      );
      sendJson(res, meResponse.status || 502, {
        error: formatOAuthError(meResponse.parsed?.error) || "Failed to fetch /v1/me",
        responseStatus: meResponse.status,
      });
      return;
    }

    const normalizedProfile = normalizeOpenAIProfile(flow, meResponse);
    console.log(
      `[openai-codex-backend] /api/ext/me success flowId=${flowId} body=${safeJsonStringify(normalizedProfile)}`,
    );
    sendJson(res, 200, normalizedProfile);
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/ext/oauth/start") {
    try {
      const body = await parseJsonBody(req);
      if (body.provider !== "openai-codex") {
        sendJson(res, 400, { error: 'provider must be "openai-codex"' });
        return;
      }
      const scope =
        typeof body.scope === "string" && body.scope.trim()
          ? body.scope.trim()
          : "openid profile email offline_access";

      const { verifier, challenge } = createPkcePair();
      const state = randomId(16);
      const flowId = randomId(12);
      const callbackUrl = `http://${DEFAULTS.callbackHost}:${DEFAULTS.callbackPort}/auth/callback`;
      const meUrl = `http://${DEFAULTS.host}:${DEFAULTS.port}/api/ext/me`;
      const authorizeUrl = buildAuthorizeUrl({
        redirectUri: callbackUrl,
        scope,
        state,
        challenge,
      });

      flows.set(flowId, {
        flowId,
        provider: body.provider,
        redirectUri: callbackUrl,
        callbackUrl,
        meUrl,
        scope,
        state,
        verifier,
        authorizeUrl,
        createdAt: Date.now(),
        phase: "pending",
        code: null,
        exchangeStatus: null,
        exchangeResponse: null,
        credentials: null,
        error: null,
      });

      sendJson(res, 200, {
        ok: true,
        provider: "openai-codex",
        flowId,
        state,
        authorizeUrl,
        callbackUrl,
        meUrl,
      });
    } catch (error) {
      sendJson(res, 500, { error: String(error?.message || error) });
    }
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/ext/oauth/exchange") {
    sendJson(res, 410, {
      error: "Manual exchange is no longer used. The callback server completes exchange automatically.",
    });
    return;
  }

  sendText(res, 404, "Not found");
});

mainServer.listen(DEFAULTS.port, DEFAULTS.host, () => {
  console.log(`[openai-codex-backend] listening on http://${DEFAULTS.host}:${DEFAULTS.port}`);
  const proxyMode = describeProxyMode();
  console.log(
    `[openai-codex-backend] proxy mode: ${proxyMode.enabled ? "enabled" : "disabled"} (${proxyMode.summary})`,
  );
});

callbackServer.listen(DEFAULTS.callbackPort, DEFAULTS.callbackHost, () => {
  console.log(
    `[openai-codex-backend] callback server listening on http://${DEFAULTS.callbackHost}:${DEFAULTS.callbackPort}/auth/callback`,
  );
});

setInterval(cleanupExpiredFlows, Math.max(60_000, Math.floor(DEFAULTS.flowTtlMs / 2))).unref();
