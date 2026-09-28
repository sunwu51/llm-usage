import test from "node:test";
import assert from "node:assert/strict";

test("login survives a refresh that started with an older account list", async () => {
  let onMessage, onNavigate;
  let releaseUsage, usageStarted, profileSeen;
  let callbackFinished;
  const blockedUsage = new Promise(resolve => { releaseUsage = resolve; });
  const started = new Promise(resolve => { usageStarted = resolve; });
  const profile = new Promise(resolve => { profileSeen = resolve; });
  const callback = new Promise(resolve => { callbackFinished = resolve; });
  const state = { accounts: { existing: { accountKey: "existing", provider: "claude",
    accountId: "existing", label: "Existing", accessToken: "old-token", refreshToken: "old-refresh",
    expiresAt: Date.now() + 3_600_000 } }, snapshots: {}, history: [], errors: {} };
  const storage = {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys])
      .filter(key => Object.hasOwn(state, key)).map(key => [key, structuredClone(state[key])])); },
    async set(values) { Object.assign(state, structuredClone(values)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key]; },
    async setAccessLevel() {}
  };
  globalThis.chrome = {
    storage: { local: storage },
    alarms: { async get(name) { return { periodInMinutes: name === "badgeCycle" ? 0.6 : 1 }; },
      async create() {}, onAlarm: { addListener() {} } },
    action: { async setTitle() {}, async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    declarativeNetRequest: { async getSessionRules() { return [{ id: 1 }]; } },
    runtime: { id: "test-extension", getURL: path => `chrome-extension://test-extension/${path}`,
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} }, onMessage: { addListener(listener) { onMessage = listener; } } },
    tabs: { async create() { return { id: 7 }; }, async update(_id, { url }) {
      assert.match(url, /login-success\.html\?provider=claude$/); callbackFinished();
    }, async remove() {},
      onUpdated: { addListener() {} }, onRemoved: { addListener() {} } },
    webNavigation: { onBeforeNavigate: { addListener(listener) { onNavigate = listener; } } }
  };
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn, originalInfo = console.info;
  console.warn = () => {}; console.info = () => {};
  let firstOldUsage = true;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/v1/oauth/token")) return Response.json({
      access_token: "new-token", refresh_token: "new-refresh", expires_in: 3600 });
    if (url.endsWith("/api/oauth/profile")) {
      profileSeen();
      return Response.json({ account: { uuid: "new", email_address: "new@example.test" } });
    }
    if (url.endsWith("/api/oauth/usage")) {
      if (options.headers.Authorization === "Bearer old-token" && firstOldUsage) {
        firstOldUsage = false;
        usageStarted();
        await blockedUsage;
      }
      return Response.json({ five_hour: { utilization: 20 } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const send = message => new Promise(resolve => onMessage(message, null, resolve));
  try {
    await import("../src/background.js");
    const refresh = send({ type: "refresh" });
    await started;
    assert.equal((await send({ type: "login", provider: "claude" })).ok, true);
    const pending = state.pendingLogin;
    onNavigate({ tabId: 7, frameId: 0,
      url: `${pending.redirect}?code=test-code&state=${pending.state}` });
    await profile;
    await new Promise(resolve => setTimeout(resolve, 10));
    releaseUsage();
    await refresh;
    await callback;
    assert.equal(state.accounts["claude:new"]?.accessToken, "new-token");
    assert.equal(state.loginError, null);
    for (let i = 0; i < 100 && !state.snapshots["claude:new"]; i++)
      await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(state.snapshots["claude:new"]);
    assert.equal((await send({ type: "removeAccount", accountKey: "claude:new" })).ok, true);
  } finally {
    releaseUsage();
    globalThis.fetch = originalFetch;
    console.warn = originalWarn; console.info = originalInfo;
    delete globalThis.chrome;
  }
});
