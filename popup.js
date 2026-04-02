document.getElementById('login').onclick = async () => {
  document.getElementById("status").textContent = "正在打开授权，请完成浏览器登录…";
  chrome.runtime.sendMessage({ type: "START_OAUTH" }, resp => {
    if (resp?.accessToken) {
      document.getElementById("status").textContent = "✔ 授权成功！可在设置页查看 Token";
    } else {
      document.getElementById("status").textContent = "❌ 授权失败：" + (resp?.error || "");
    }
  });
};