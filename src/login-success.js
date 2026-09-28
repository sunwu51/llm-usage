const provider = new URL(location.href).searchParams.get("provider");
const name = provider === "codex" ? "Codex" : provider === "claude" ? "Claude" : "Account";
document.querySelector("#success-title").textContent = `${name} connected`;
document.querySelector("#view-usage").addEventListener("click", () => {
  location.href = chrome.runtime.getURL("popup.html");
});
document.querySelector("#close-page").addEventListener("click", async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
});
