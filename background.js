const OAUTH_URL = "https://chat.openai.com/oauth/authorize";
const CLIENT_ID = "YOUR_CLIENT_ID"; // 请替换为你自己申请的 OpenAI OAuth client_id
const RESPONSE_TYPE = "token";
const SCOPES = "openid email profile";
const REDIRECT_URI = chrome.identity.getRedirectURL("openai-codex");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_OAUTH") {
    chrome.identity.launchWebAuthFlow({
      url: `${OAUTH_URL}?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=${RESPONSE_TYPE}&scope=${encodeURIComponent(SCOPES)}`,
      interactive: true
    }, function (redirectUrl) {
      if (!redirectUrl) {
        sendResponse({ error: "No token returned, canceled or failed." });
        return;
      }
      const hash = new URL(redirectUrl).hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const idToken = params.get('id_token');
      if (accessToken) {
        chrome.storage.local.set({ codex_token: accessToken, id_token: idToken });
        sendResponse({ accessToken, idToken });
      } else {
        sendResponse({ error: "No access_token" });
      }
    });
    return true;
  }
});