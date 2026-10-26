import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings, buildPayload, applyPayload, encodePayload, decodePayload, pushRemote, pullRemote,
  conflictMessage, SYNC_FILE, META_FILE } from "../src/sync.js";

const settings = normalizeSettings({ role: "primary", token: "gh", gistId: "g1", deviceId: "mini", deviceName: "Mac mini" });
const data = { accounts: { "claude:1": { accountKey: "claude:1", provider: "claude", accountId: "1", label: "a@b.c",
    addedAt: 5, accessToken: "SECRET-A", refreshToken: "SECRET-R" } },
  snapshots: { "claude:1": { accountKey: "claude:1", metrics: [], at: 10 } },
  history: [{ accountKey: "claude:1", metricId: "claude-five_hour", at: 1, used: 3, resetAt: 2, title: "5h" }] };

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body && JSON.parse(init.body), headers: init.headers });
    const route = routes.shift();
    return { status: route.status ?? 200, ok: (route.status ?? 200) < 400, headers: { get: () => route.etag ?? null },
      json: async () => route.json, text: async () => route.text };
  };
  impl.calls = calls;
  return impl;
}

test("payload never contains credentials and round-trips through gzip", async () => {
  const payload = buildPayload(data, settings, 100);
  const text = await encodePayload(payload);
  assert.ok(!JSON.stringify(payload).includes("SECRET"));
  assert.ok(!text.includes("SECRET"));
  const applied = applyPayload(await decodePayload(text));
  assert.deepEqual(applied.history, data.history);
  assert.equal(applied.accounts["claude:1"].refreshToken, undefined);
  assert.equal(applied.accounts["claude:1"].label, "a@b.c");
});

test("applyPayload rejects unknown formats", () => {
  assert.throws(() => applyPayload({ version: 99, accounts: [], history: [], snapshots: {} }), /unsupported/);
  assert.throws(() => applyPayload(null), /unsupported/);
});

test("primary creates a private gist when none is configured", async () => {
  const fetchImpl = fakeFetch([{ json: { id: "new-gist" } }]);
  const result = await pushRemote({ ...settings, gistId: "" }, buildPayload(data, settings, 100), fetchImpl);
  assert.equal(result.gistId, "new-gist");
  assert.equal(fetchImpl.calls[0].method, "POST");
  assert.equal(fetchImpl.calls[0].body.public, false);
  assert.deepEqual(Object.keys(fetchImpl.calls[0].body.files).sort(), [META_FILE, SYNC_FILE].sort());
});

test("primary updates its own gist but refuses to overwrite a recent other primary", async () => {
  const now = 1_000_000;
  const own = { files: { [META_FILE]: { content: JSON.stringify({ deviceId: "mini", updatedAt: now - 60_000 }) } } };
  const ok = fakeFetch([{ json: own }, { json: {} }]);
  await pushRemote(settings, buildPayload(data, settings, now), ok);
  assert.equal(ok.calls[1].method, "PATCH");

  const other = { files: { [META_FILE]: { content: JSON.stringify({ deviceId: "laptop", deviceName: "Laptop", updatedAt: now - 60_000 }) } } };
  const blocked = fakeFetch([{ json: other }]);
  await assert.rejects(pushRemote(settings, buildPayload(data, settings, now), blocked), /Another primary device "Laptop"/);
  assert.equal(blocked.calls.length, 1);
  assert.equal(conflictMessage({ deviceId: "laptop", updatedAt: now - 20 * 60_000 }, settings, now), null);
});

test("viewer pulls data and honours 304", async () => {
  const text = await encodePayload(buildPayload(data, settings, 100));
  const fetchImpl = fakeFetch([{ json: { files: { [SYNC_FILE]: { content: text } } }, etag: 'W/"1"' }, { status: 304 }]);
  const viewer = { ...settings, role: "viewer", deviceId: "laptop" };
  const first = await pullRemote(viewer, undefined, fetchImpl);
  assert.equal(first.etag, 'W/"1"');
  assert.equal(first.payload.history.length, 1);
  assert.deepEqual(await pullRemote(viewer, first.etag, fetchImpl), { notModified: true });
  assert.equal(fetchImpl.calls[1].headers["If-None-Match"], 'W/"1"');
});

test("auth and missing-gist errors are readable", async () => {
  await assert.rejects(pullRemote(settings, undefined, fakeFetch([{ status: 401 }])), /rejected the token/);
  await assert.rejects(pullRemote(settings, undefined, fakeFetch([{ status: 404 }])), /Gist not found/);
  await assert.rejects(pullRemote(settings, undefined, fakeFetch([{ json: { files: {} } }])), /no synced data/);
});

test("a hung GitHub request fails with a timeout instead of blocking", async () => {
  const hung = (_url, init) => new Promise((_, reject) =>
    init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  const original = AbortSignal.timeout;
  AbortSignal.timeout = () => original.call(AbortSignal, 10);
  try { await assert.rejects(pullRemote(settings, undefined, hung), /timed out/); }
  finally { AbortSignal.timeout = original; }
});
