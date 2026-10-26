// Cross-device sync through a private GitHub Gist. Only usage data travels; tokens never leave the primary.
export const SYNC_ROLES = ["standalone", "primary", "viewer"];
export const SYNC_FILE = "llm-usage.json.gz.b64";
export const META_FILE = "meta.json";
export const PRIMARY_TAKEOVER_MS = 15 * 60_000;
const API = "https://api.github.com";
const PAYLOAD_VERSION = 1;
const REQUEST_TIMEOUT_MS = 20_000; // a hung request would otherwise hold the refresh lock indefinitely

export function normalizeSettings(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return { role: SYNC_ROLES.includes(value.role) ? value.role : "standalone",
    gistId: String(value.gistId || "").trim(), token: String(value.token || "").trim(),
    deviceId: String(value.deviceId || ""), deviceName: String(value.deviceName || "").trim() || "This device" };
}

export function buildPayload({ accounts, snapshots, history }, settings, now = Date.now()) {
  const safeAccounts = Object.values(accounts || {}).map(account => ({ accountKey: account.accountKey,
    provider: account.provider, accountId: account.accountId, label: account.label, addedAt: account.addedAt }));
  return { version: PAYLOAD_VERSION, deviceId: settings.deviceId, deviceName: settings.deviceName,
    updatedAt: now, accounts: safeAccounts, snapshots: snapshots || {}, history: history || [] };
}

export function applyPayload(payload) {
  if (!payload || payload.version !== PAYLOAD_VERSION || !Array.isArray(payload.accounts) ||
      !Array.isArray(payload.history) || typeof payload.snapshots !== "object" || !payload.snapshots)
    throw new Error("Synced data has an unsupported format");
  const accounts = Object.fromEntries(payload.accounts.filter(account => account?.accountKey && account.provider)
    .map(account => [account.accountKey, { ...account }]));
  return { accounts, snapshots: payload.snapshots, history: payload.history };
}

async function transform(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
export async function encodePayload(payload) {
  const bytes = await transform(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream("gzip"));
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
export async function decodePayload(text) {
  const bytes = Uint8Array.from(atob(text.trim()), char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(await transform(bytes, new DecompressionStream("gzip"))));
}

async function github(path, settings, fetchImpl, { method = "GET", body, etag } = {}) {
  const response = await fetchImpl(path.startsWith("http") ? path : `${API}${path}`, { method, body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${settings.token}`,
      "X-GitHub-Api-Version": "2022-11-28", ...(etag ? { "If-None-Match": etag } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}) } })
    .catch(error => { throw error.name === "TimeoutError" ? new Error("GitHub request timed out") : error; });
  if (response.status === 304) return { response };
  if (response.status === 401) throw new Error("GitHub rejected the token");
  if (response.status === 404) throw new Error("Gist not found, or the token cannot access it");
  if (!response.ok) throw new Error(`GitHub: HTTP ${response.status}`);
  return { response };
}

async function fileContent(file, settings, fetchImpl) {
  if (!file) return null;
  if (!file.truncated) return file.content;
  return (await (await github(file.raw_url, settings, fetchImpl)).response.text());
}

export function conflictMessage(meta, settings, now = Date.now()) {
  if (!meta?.deviceId || meta.deviceId === settings.deviceId || !(now - meta.updatedAt < PRIMARY_TAKEOVER_MS)) return null;
  return `Another primary device "${meta.deviceName || meta.deviceId}" synced ${Math.max(1, Math.round((now - meta.updatedAt) / 60_000))} min ago`;
}

export async function pushRemote(settings, payload, fetchImpl = fetch) {
  if (!settings.token) throw new Error("GitHub token is required");
  const files = { [META_FILE]: { content: JSON.stringify({ deviceId: payload.deviceId,
      deviceName: payload.deviceName, updatedAt: payload.updatedAt }) },
    [SYNC_FILE]: { content: await encodePayload(payload) } };
  if (!settings.gistId) {
    const { response } = await github("/gists", settings, fetchImpl, { method: "POST",
      body: { description: "LLM Usage sync", public: false, files } });
    return { gistId: (await response.json()).id };
  }
  const { response } = await github(`/gists/${settings.gistId}`, settings, fetchImpl);
  const remote = await response.json();
  const metaText = await fileContent(remote.files?.[META_FILE], settings, fetchImpl);
  let meta = null;
  try { meta = metaText && JSON.parse(metaText); } catch { /* unreadable meta is overwritten */ }
  const conflict = conflictMessage(meta, settings, payload.updatedAt);
  if (conflict) throw new Error(conflict);
  await github(`/gists/${settings.gistId}`, settings, fetchImpl, { method: "PATCH", body: { files } });
  return { gistId: settings.gistId };
}

export async function pullRemote(settings, etag, fetchImpl = fetch) {
  if (!settings.token) throw new Error("GitHub token is required");
  if (!settings.gistId) throw new Error("Gist ID is required");
  const { response } = await github(`/gists/${settings.gistId}`, settings, fetchImpl, { etag });
  if (response.status === 304) return { notModified: true };
  const remote = await response.json();
  const text = await fileContent(remote.files?.[SYNC_FILE], settings, fetchImpl);
  if (!text) throw new Error("The Gist has no synced data yet. Start the primary device first");
  return { payload: await decodePayload(text), etag: response.headers.get("etag") };
}
