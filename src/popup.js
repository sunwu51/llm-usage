import { STORAGE, STALE_MS, PROVIDERS, orderedAccounts } from "./model.js";

const $ = selector => document.querySelector(selector);
let renderRequest = 0;
const time = value => value ? new Date(value).toLocaleString() : "Not yet checked";
const remaining = value => `${Math.round(100 - value)}% remaining`;
async function command(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...extra });
  if (!result?.ok) throw new Error(result?.error || "Something went wrong");
  return result.value;
}
function element(tag, className, content) {
  const node = document.createElement(tag); node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function renderMetric(metric) {
  const row = element("div", "metric");
  const heading = element("div", "metric-heading");
  heading.append(element("strong", "", metric.title), element("span", "", remaining(metric.used)));
  const track = element("div", "track");
  const fill = element("div", `fill ${metric.used >= 90 ? "danger" : ""}`);
  fill.style.width = `${metric.used}%`; track.append(fill);
  row.append(heading, track, element("small", "muted", metric.resetAt ? `Resets: ${time(metric.resetAt)}` : "Reset time unavailable"));
  return row;
}
function renderResetCredits(resetCredits) {
  const block = element("div", "reset-credits");
  const heading = element("div", "metric-heading");
  heading.append(element("strong", "", `Available resets: ${resetCredits.availableCount}`));
  const next = resetCredits.available.find(credit => credit.expiresAt);
  if (next) heading.append(element("small", "muted", `Next expiry: ${time(next.expiresAt)}`));
  block.append(heading);
  for (const [index, credit] of resetCredits.available.slice(0, 3).entries())
    block.append(element("small", "muted reset-credit-row", `Reset ${index + 1} · ${credit.expiresAt ? `Expires ${time(credit.expiresAt)}` : "No expiry time"}`));
  return block;
}
async function render() {
  const request = ++renderRequest;
  const data = await chrome.storage.local.get(Object.values(STORAGE).concat("loginError", "manualClaudeExchange"));
  if (request !== renderRequest) return;
  const accounts = orderedAccounts(data.accounts || {}, data.history || []);
  const snapshots = data.snapshots || {};
  const errors = data.errors || {};
  const manual = data.manualClaudeExchange;
  $("#manual-claude").classList.toggle("hidden", !manual);
  if (manual) {
    $("#claude-curl").value = manual.curl;
    $("#claude-node").value = manual.nodeFetch || "Start Claude sign-in again to generate a Node command";
    $("#copy-node").disabled = !manual.nodeFetch;
  }
  const root = $("#accounts"); root.replaceChildren();
  if (!accounts.length) root.append(element("p", "empty", "Connect Codex or Claude to view your usage."));
  for (const account of accounts) {
    const snapshot = snapshots[account.accountKey];
    const card = element("section", "card");
    const head = element("div", "card-head");
    head.append(element("h2", "", `${PROVIDERS[account.provider]} · ${account.label}`));
    const remove = element("button", "text-button", "Remove");
    remove.title = `Remove ${account.label}'s local tokens, snapshots, and history`;
    remove.addEventListener("click", async () => { await command("removeAccount", { accountKey: account.accountKey }); await render(); });
    head.append(remove); card.append(head);
    if (snapshot) {
      if (snapshot.plan) card.append(element("div", "muted", `Plan: ${snapshot.plan}`));
      if (snapshot.metrics.length) snapshot.metrics.forEach(metric => card.append(renderMetric(metric)));
      else card.append(element("p", "muted", "No usage windows returned yet"));
      if (account.provider === "codex") {
        if (snapshot.resetCredits) card.append(renderResetCredits(snapshot.resetCredits));
        else if (snapshot.resetCreditsError) card.append(element("small", "muted", "Reset credits unavailable"));
      }
      card.append(element("div", Date.now() - snapshot.at > STALE_MS ? "stale" : "muted",
        `Last refreshed: ${time(snapshot.at)}${Date.now() - snapshot.at > STALE_MS ? " · Data may be stale" : ""}`));
    } else card.append(element("p", "muted", "Waiting for the first check"));
    if (errors[account.accountKey]) card.append(element("p", "error", errors[account.accountKey].message));
    root.append(card);
  }
  $("#status").textContent = data.loginError ? `Sign-in failed: ${data.loginError}` :
    `Last successful refresh: ${time(Math.max(0, ...Object.values(snapshots).map(s => s.at)))}`;
}
async function run(button, action) {
  button.disabled = true;
  try { await action(); await render(); } catch (error) { $("#status").textContent = error.message; }
  finally { button.disabled = false; }
}
$("#refresh").addEventListener("click", event => run(event.currentTarget, () => command("refresh")));
for (const provider of ["codex", "claude"]) $( `#${provider}-login` ).addEventListener("click", event =>
  run(event.currentTarget, async () => { await chrome.storage.local.remove("loginError"); await command("login", { provider }); }));
$("#history").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("history.html") }));
$("#copy-curl").addEventListener("click", async () => { await navigator.clipboard.writeText($("#claude-curl").value); $("#status").textContent = "curl command copied"; });
$("#copy-node").addEventListener("click", async () => { await navigator.clipboard.writeText($("#claude-node").value); $("#status").textContent = "Node fetch command copied"; });
$("#complete-claude").addEventListener("click", event => run(event.currentTarget, async () => {
  await command("completeManualClaude", { tokens: $("#claude-json").value });
}));
chrome.storage.onChanged.addListener(() => { void render(); });
void render().then(() => command("refreshIfStale")).then(() => render()).catch(error => { $("#status").textContent = error.message; });
