import { codexIdentity, parseCodexUsage, parseCodexResetCredits, parseClaudeUsage } from "./model.js";

const CONFIG = {
  codex: { clientId: "app_EMoamEEZ73f0CkXaXp7hrann", auth: "https://auth.openai.com/oauth/authorize",
    token: "https://auth.openai.com/oauth/token", redirect: "http://localhost:1457/auth/callback",
    scope: "openid profile email offline_access api.connectors.read api.connectors.invoke" },
  claude: { clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e", auth: "https://claude.com/cai/oauth/authorize",
    token: "https://platform.claude.com/v1/oauth/token", redirect: "http://localhost:54546/callback",
    scope: "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload" }
};
export const callbackUrls = Object.values(CONFIG).map(config => config.redirect);

const CLAUDE_TOKEN_RULE_ID = 1;
let claudeTokenRuleJob;
export function claudeTokenHeaderRule(extensionId) {
  return { id: CLAUDE_TOKEN_RULE_ID, priority: 1,
    action: { type: "modifyHeaders", requestHeaders: [
      { header: "user-agent", operation: "set", value: "node" }
    ] },
    condition: { urlFilter: `|${CONFIG.claude.token}|`, requestMethods: ["post"],
      initiatorDomains: [extensionId] } };
}
export function ensureClaudeTokenHeaderRule() {
  if (!claudeTokenRuleJob) claudeTokenRuleJob = (async () => {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    if (rules.some(rule => rule.id === CLAUDE_TOKEN_RULE_ID)) return;
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [claudeTokenHeaderRule(chrome.runtime.id)]
    });
  })().finally(() => { claudeTokenRuleJob = null; });
  return claudeTokenRuleJob;
}

export function claudeExchangeCommands(body) {
  const json = JSON.stringify(body);
  const input = `@'\n${json}\n'@`;
  const tokenUrl = CONFIG.claude.token;
  const curl = `${input} | curl.exe --http1.1 -sS '${tokenUrl}' -H 'Accept: application/json, text/plain, */*' -H 'Content-Type: application/json' --data-binary '@-'`;
  const script = `const body=${json};fetch("${tokenUrl}",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(async response=>{console.error("HTTP",response.status);console.log(await response.text());}).catch(error=>{console.error(error);process.exitCode=1;});`;
  return { curl, nodeFetch: `node -e '${script}'` };
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function randomString() { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
async function pkceChallenge(verifier) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}
async function responseJson(response, context) {
  if (!response.ok) {
    let serverMessage;
    try {
      const body = await response.json();
      serverMessage = body?.error?.message || body?.error_description || body?.message;
    } catch { /* The endpoint did not return JSON. */ }
    const retry = response.headers.get("retry-after");
    const retrySeconds = retry && /^\d+$/.test(retry) ? Number(retry) : null;
    const hint = response.status === 429
      ? `Rate limited${retrySeconds !== null ? `; retry after at least ${retrySeconds} seconds` : "; please try again later"}`
      : null;
    const detail = [hint, typeof serverMessage === "string" ? serverMessage.slice(0, 240) : null]
      .filter(Boolean).join("; ");
    const error = new Error(`${context}: HTTP ${response.status}${detail ? ` · ${detail}` : ""}`);
    error.status = response.status;
    error.retrySeconds = retrySeconds;
    throw error;
  }
  return response.json();
}

export async function startLogin(provider, redirectOverride = null) {
  const config = CONFIG[provider];
  if (!config) throw new Error("Unsupported provider");
  const verifier = randomString();
  const state = randomString();
  const url = new URL(config.auth);
  const redirect = redirectOverride || config.redirect;
  Object.entries({ response_type: "code", client_id: config.clientId, redirect_uri: redirect,
    scope: config.scope, code_challenge: await pkceChallenge(verifier), code_challenge_method: "S256", state })
    .forEach(([key, value]) => url.searchParams.set(key, value));
  if (provider === "claude") url.searchParams.set("code", "true");
  if (provider === "codex") Object.entries({ id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true", originator: "agentbar", prompt: "login consent" })
    .forEach(([key, value]) => url.searchParams.set(key, value));
  return { url: url.href, pending: { provider, state, verifier, redirect,
    startedAt: Date.now(), tabId: null } };
}

export function matchesCallback(pending, tabId, rawUrl) {
  if (!pending || pending.tabId !== tabId || Date.now() - pending.startedAt > 5 * 60_000) return false;
  try { const url = new URL(rawUrl); const expected = new URL(pending.redirect);
    return url.origin === expected.origin && url.pathname === expected.pathname;
  } catch { return false; }
}

export async function completeLogin(pending, callbackUrl) {
  const config = CONFIG[pending.provider];
  const url = new URL(callbackUrl);
  if (url.searchParams.get("state") !== pending.state) throw new Error("OAuth state mismatch");
  if (url.searchParams.has("error")) throw new Error(`Login rejected: ${url.searchParams.get("error")}`);
  const code = url.searchParams.get("code");
  if (!code) throw new Error("Authorization code missing");
  const body = { grant_type: "authorization_code", code, redirect_uri: pending.redirect,
    client_id: config.clientId, code_verifier: pending.verifier };
  if (pending.provider === "claude") body.state = pending.state;
  if (pending.provider === "claude") await ensureClaudeTokenHeaderRule();
  const response = await fetch(config.token, { method: "POST",
    headers: { "Content-Type": pending.provider === "codex" ? "application/x-www-form-urlencoded" : "application/json" },
    body: pending.provider === "codex" ? new URLSearchParams(body) : JSON.stringify(body) });
  const tokens = await responseJson(response, `${pending.provider} token exchange`);
  if (!tokens.access_token || !tokens.refresh_token) throw new Error("Token response incomplete");
  if (pending.provider === "codex") {
    const identity = codexIdentity(tokens.id_token);
    if (!identity.accountId) throw new Error("Codex account ID missing");
    return { provider: "codex", accountKey: `codex:${identity.accountId}`, accountId: identity.accountId,
      label: identity.label, accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      idToken: tokens.id_token, expiresAt: null };
  }
  const profile = await fetchClaudeProfile(tokens.access_token);
  const accountId = profile?.account?.uuid || profile?.account?.id || profile?.account_uuid ||
    profile?.account?.email_address || profile?.email_address;
  if (!accountId) throw new Error("Claude account ID missing");
  return { provider: "claude", accountKey: `claude:${accountId}`, accountId,
    label: profile?.account?.email_address || profile?.email_address || "Claude account",
    accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 };
}

async function fetchClaudeProfile(token) {
  const response = await fetch("https://api.anthropic.com/api/oauth/profile", { headers: {
    Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" } });
  return responseJson(response, "Claude profile");
}

export async function refreshAccount(account, force = false) {
  const config = CONFIG[account.provider];
  const expiring = account.provider === "codex" ? (() => {
    try { const jwt = JSON.parse(atob(account.accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return jwt.exp * 1000 < Date.now() + 60_000; } catch { return true; }
  })() : account.expiresAt < Date.now() + 5 * 60_000;
  if (!force && !expiring) return account;
  const body = { grant_type: "refresh_token", refresh_token: account.refreshToken, client_id: config.clientId };
  if (account.provider === "claude") await ensureClaudeTokenHeaderRule();
  const response = await fetch(config.token, { method: "POST",
    headers: { "Content-Type": account.provider === "codex" ? "application/x-www-form-urlencoded" : "application/json" },
    body: account.provider === "codex" ? new URLSearchParams(body) : JSON.stringify(body) });
  const tokens = await responseJson(response, `${account.provider} token refresh`);
  if (!tokens.access_token) throw new Error("Refresh returned no access token");
  if (account.provider === "codex" && tokens.id_token) {
    const identity = codexIdentity(tokens.id_token);
    if (identity.accountId !== account.accountId) throw new Error("Refresh returned a different Codex account");
  }
  return { ...account, accessToken: tokens.access_token, refreshToken: tokens.refresh_token || account.refreshToken,
    idToken: tokens.id_token || account.idToken,
    expiresAt: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : account.expiresAt };
}

export async function fetchUsage(account) {
  if (account.provider === "codex") {
    const headers = { Authorization: `Bearer ${account.accessToken}`, "ChatGPT-Account-Id": account.accountId };
    const response = await fetch("https://chatgpt.com/backend-api/wham/usage", { headers });
    if (response.status === 401) { const error = new Error("Codex token expired"); error.authFailure = true; throw error; }
    const usage = parseCodexUsage(await responseJson(response, "Codex usage"));
    try {
      const creditsResponse = await fetch("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits", {
        headers: { ...headers, Accept: "application/json", originator: "Codex Desktop", "OAI-Product-Sku": "CODEX" } });
      usage.resetCredits = parseCodexResetCredits(await responseJson(creditsResponse, "Codex reset credits"));
    } catch (error) {
      usage.resetCreditsError = error.message;
    }
    return usage;
  }
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", { headers: {
    Authorization: `Bearer ${account.accessToken}`, "anthropic-beta": "oauth-2025-04-20" } });
  if (response.status === 401) { const error = new Error("Claude token expired"); error.authFailure = true; throw error; }
  return parseClaudeUsage(await responseJson(response, "Claude usage"));
}
