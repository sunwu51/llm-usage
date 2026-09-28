import { STORAGE, STALE_MS, appendHistory, shortSummary, badgeSlides, orderedAccounts } from "./model.js";
import { startLogin, matchesCallback, completeLogin, refreshAccount, fetchUsage, claudeExchangeCommands } from "./providers.js";

let refreshJob = null;
let callbackJob = null;
let stateTail = Promise.resolve();
let badgeTimers = [];
let badgeGeneration = 0;
const read = async () => chrome.storage.local.get([...Object.values(STORAGE), "manualClaudeExchange"]);
const write = async data => chrome.storage.local.set(data);
function withStateLock(action) {
  const job = stateTail.then(action);
  stateTail = job.catch(() => {});
  return job;
}
function retainAddedAt(account, accounts, history) {
  const existing = accounts[account.accountKey];
  const firstSample = history.reduce((at, row) => row.accountKey === account.accountKey && Number.isFinite(row.at)
    ? Math.min(at, row.at) : at, Infinity);
  return { ...account, addedAt: existing?.addedAt ?? (Number.isFinite(firstSample) ? firstSample : Date.now()) };
}
async function updateAction(accounts, snapshots, history = []) {
  const generation = ++badgeGeneration;
  badgeTimers.forEach(clearTimeout);
  badgeTimers = [];
  const orderedSnapshots = orderedAccounts(accounts, history).map(account => snapshots[account.accountKey]).filter(Boolean);
  const slides = badgeSlides(accounts, snapshots, history);
  const first = slides[0] || { text: "", color: "#475569" };
  await Promise.all([
    chrome.action.setTitle({ title: shortSummary(orderedSnapshots) }),
    chrome.action.setBadgeText({ text: first.text }),
    chrome.action.setBadgeBackgroundColor({ color: first.color })
  ]);
  if (slides.length > 1 && generation === badgeGeneration) {
    for (const [delay, slide] of [[3000, slides[1]], [6000, slides[0]]])
      badgeTimers.push(setTimeout(() => {
        if (generation !== badgeGeneration) return;
        void Promise.all([
          chrome.action.setBadgeText({ text: slide.text }),
          chrome.action.setBadgeBackgroundColor({ color: slide.color })
        ]);
      }, delay));
  }
}

async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  if (!await chrome.alarms.get("refresh")) await chrome.alarms.create("refresh", { periodInMinutes: 1 });
  const badgeAlarm = await chrome.alarms.get("badgeCycle");
  if (badgeAlarm?.periodInMinutes !== 0.6)
    await chrome.alarms.create("badgeCycle", { periodInMinutes: 0.6 });
  const { accounts = {}, snapshots = {}, history = [] } = await read();
  await updateAction(accounts, snapshots, history);
}
chrome.runtime.onInstalled.addListener(() => { void initialize(); });
chrome.runtime.onStartup.addListener(() => { void initialize().then(() => refreshAll(false)); });
void initialize();

async function refreshAll(force) {
  if (refreshJob) return refreshJob;
  refreshJob = withStateLock(async () => {
    const state = await read();
    const accounts = { ...(state.accounts || {}) };
    const snapshots = { ...(state.snapshots || {}) };
    const errors = { ...(state.errors || {}) };
    let history = state.history || [];
    for (const [key, original] of Object.entries(accounts)) {
      if (!force && Date.now() - (snapshots[key]?.at || 0) < STALE_MS) continue;
      try {
        let account = await refreshAccount(original);
        let usage;
        try { usage = await fetchUsage(account); }
        catch (error) { if (!error.authFailure) throw error;
          account = await refreshAccount(account, true); usage = await fetchUsage(account); }
        accounts[key] = account;
        const at = Date.now();
        const snapshot = { accountKey: key, provider: account.provider, label: account.label,
          plan: usage.plan, metrics: usage.metrics, resetCredits: usage.resetCredits || null,
          resetCreditsError: usage.resetCreditsError || null, at };
        snapshots[key] = snapshot;
        history = appendHistory(history, snapshot, at);
        delete errors[key];
        // Persist rotating refresh tokens immediately after each account succeeds.
        await write({ [STORAGE.accounts]: accounts, [STORAGE.snapshots]: snapshots,
          [STORAGE.history]: history, [STORAGE.errors]: errors });
      } catch (error) {
        errors[key] = { message: error.message, at: Date.now() };
        await write({ [STORAGE.errors]: errors });
      }
    }
    await updateAction(accounts, snapshots, history);
    return { snapshots, errors };
  }).finally(() => { refreshJob = null; });
  return refreshJob;
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "refresh") void refreshAll(false);
  if (alarm.name === "badgeCycle") void read().then(({ accounts = {}, snapshots = {}, history = [] }) => updateAction(accounts, snapshots, history));
});

async function beginLogin(provider) {
  const { pendingLogin } = await chrome.storage.local.get(STORAGE.pending);
  if (pendingLogin && Date.now() - pendingLogin.startedAt < 5 * 60_000 &&
      await chrome.tabs.get(pendingLogin.tabId).then(() => true, () => false))
    throw new Error("Another login is in progress");
  await chrome.storage.local.remove(STORAGE.pending);
  if (provider === "claude") {
    // Claude does not accept chromiumapp.org for this public OAuth client.
    await chrome.storage.local.remove("manualClaudeExchange");
    const login = await startLogin(provider);
    const tab = await chrome.tabs.create({ url: login.url });
    await write({ [STORAGE.pending]: { ...login.pending, tabId: tab.id } });
    return { started: true };
  }
  const login = await startLogin(provider);
  const tab = await chrome.tabs.create({ url: login.url });
  await write({ [STORAGE.pending]: { ...login.pending, tabId: tab.id } });
  return { started: true };
}

async function showLoginSuccess(tabId, provider) {
  const url = chrome.runtime.getURL(`login-success.html?provider=${encodeURIComponent(provider)}`);
  try { await chrome.tabs.update(tabId, { url }); }
  catch { await chrome.tabs.create({ url }); }
}

async function handleNavigation(tabId, url) {
  if (callbackJob) return;
  const { pendingLogin } = await chrome.storage.local.get(STORAGE.pending);
  if (!matchesCallback(pendingLogin, tabId, url)) return;
  callbackJob = (async () => {
    await chrome.storage.local.remove(STORAGE.pending);
    let saved = false;
    try {
      const account = await completeLogin(pendingLogin, url);
      await withStateLock(async () => {
        const { accounts = {}, errors = {}, history = [] } = await read();
        accounts[account.accountKey] = retainAddedAt(account, accounts, history);
        delete errors[account.accountKey];
        await write({ [STORAGE.accounts]: accounts, [STORAGE.errors]: errors, loginError: null });
      });
      saved = true;
      try { await showLoginSuccess(tabId, account.provider); }
      catch (error) { console.error("[LLM Usage] Unable to show login success page", error); }
      void refreshAll(true).catch(error => console.error("[LLM Usage] Refresh after login failed", error));
    } catch (error) {
      if (pendingLogin.provider === "claude" && error.status === 429 &&
          error.message.startsWith("claude token exchange")) {
        const code = new URL(url).searchParams.get("code");
        const body = { grant_type: "authorization_code", code, redirect_uri: pendingLogin.redirect,
          client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e", code_verifier: pendingLogin.verifier,
          state: pendingLogin.state };
        await write({ manualClaudeExchange: { ...claudeExchangeCommands(body), pending: pendingLogin, createdAt: Date.now() } });
      }
      await write({ loginError: error.message });
    } finally {
      if (!saved) try { await chrome.tabs.remove(tabId); } catch { /* tab already closed */ }
    }
  })().finally(() => { callbackJob = null; });
  await callbackJob;
}

chrome.webNavigation.onBeforeNavigate.addListener(details => {
  if (details.frameId === 0) void handleNavigation(details.tabId, details.url);
}, { url: [
  { hostEquals: "localhost", schemes: ["http"] },
  { hostEquals: "platform.claude.com", pathPrefix: "/oauth/code/callback", schemes: ["https"] }
] });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url?.startsWith("http://localhost:") ||
      change.url?.startsWith("https://platform.claude.com/oauth/code/callback"))
    void handleNavigation(tabId, change.url);
});
chrome.tabs.onRemoved.addListener(async tabId => {
  const { pendingLogin } = await chrome.storage.local.get(STORAGE.pending);
  if (pendingLogin?.tabId === tabId) await chrome.storage.local.remove(STORAGE.pending);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "login") return beginLogin(message.provider);
    if (message.type === "refresh") return refreshAll(true);
    if (message.type === "refreshIfStale") return refreshAll(false);
    if (message.type === "completeManualClaude") {
      const state = await read();
      const pending = state.manualClaudeExchange?.pending;
      if (!pending) throw new Error("No Claude sign-in is waiting for a token response");
      const tokens = typeof message.tokens === "string" ? JSON.parse(message.tokens) : message.tokens;
      if (!tokens?.access_token || !tokens?.refresh_token) throw new Error("JSON is missing access_token or refresh_token");
      const account = await completeLoginWithTokens(pending, tokens);
      await withStateLock(async () => {
        const latest = await read();
        const accounts = { ...(latest.accounts || {}) }, errors = { ...(latest.errors || {}) };
        accounts[account.accountKey] = retainAddedAt(account, accounts, latest.history || []); delete errors[account.accountKey];
        await write({ [STORAGE.accounts]: accounts, [STORAGE.errors]: errors,
          manualClaudeExchange: null, loginError: null });
      });
      await chrome.tabs.create({ url: chrome.runtime.getURL("login-success.html?provider=claude") });
      void refreshAll(true).catch(error => console.error("[LLM Usage] Refresh after login failed", error));
      return { completed: true };
    }
    if (message.type === "removeAccount") {
      return withStateLock(async () => {
        const state = await read();
        const accounts = state.accounts || {}, snapshots = state.snapshots || {}, errors = state.errors || {};
        delete accounts[message.accountKey]; delete snapshots[message.accountKey]; delete errors[message.accountKey];
        const history = (state.history || []).filter(row => row.accountKey !== message.accountKey);
        await write({ [STORAGE.accounts]: accounts, [STORAGE.snapshots]: snapshots,
          [STORAGE.errors]: errors, [STORAGE.history]: history });
        await updateAction(accounts, snapshots, history);
        return { removed: true };
      });
    }
    throw new Error("Unknown command");
  })().then(value => sendResponse({ ok: true, value }), error => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function completeLoginWithTokens(pending, tokens) {
  let profile = tokens;
  if (!tokens?.account?.uuid && !tokens?.account?.email_address) {
    const response = await fetch("https://api.anthropic.com/api/oauth/profile", { headers: {
      Authorization: `Bearer ${tokens.access_token}`, "anthropic-beta": "oauth-2025-04-20" } });
    if (!response.ok) throw new Error(`Claude profile: HTTP ${response.status}`);
    profile = await response.json();
  }
  const accountId = profile?.account?.uuid || profile?.account?.id || profile?.account_uuid || profile?.account?.email_address;
  if (!accountId) throw new Error("Claude account ID missing");
  return { provider: "claude", accountKey: `claude:${accountId}`, accountId,
    label: profile?.account?.email_address || profile?.email_address || "Claude account",
    accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 };
}
