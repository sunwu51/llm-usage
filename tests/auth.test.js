import test from "node:test";
import assert from "node:assert/strict";
import { matchesCallback, startLogin, claudeExchangeCommands, claudeTokenHeaderRule } from "../src/providers.js";

test("Claude token rule only targets extension POSTs to the token endpoint", () => {
  const rule = claudeTokenHeaderRule("example-extension-id");
  assert.deepEqual(rule.condition, {
    urlFilter: "|https://platform.claude.com/v1/oauth/token|",
    requestMethods: ["post"], initiatorDomains: ["example-extension-id"]
  });
  assert.deepEqual(rule.action.requestHeaders, [
    { header: "user-agent", operation: "set", value: "node" }
  ]);
});

test("Claude curl and Node commands carry the same token request", () => {
  const body = { grant_type: "authorization_code", code: "sample-code", code_verifier: "sample-verifier", state: "sample-state" };
  const { curl, nodeFetch } = claudeExchangeCommands(body);
  const input = `@'\n${JSON.stringify(body)}\n'@ | `;
  assert.ok(curl.startsWith(input));
  assert.ok(nodeFetch.startsWith(`node -e 'const body=${JSON.stringify(body)};fetch(`));
  assert.match(nodeFetch, /body:JSON\.stringify\(body\)/);
  assert.match(nodeFetch, /fetch\("https:\/\/platform\.claude\.com\/v1\/oauth\/token"/);
  assert.match(nodeFetch, /console\.error\("HTTP",response\.status\)/);
});

test("Claude authorization follows the Claude.ai client flow", async () => {
  const { url, pending } = await startLogin("claude");
  const auth = new URL(url);
  assert.equal(auth.origin + auth.pathname, "https://claude.com/cai/oauth/authorize");
  assert.equal(auth.searchParams.get("code"), "true");
  assert.equal(auth.searchParams.get("redirect_uri"), pending.redirect);
  assert.equal(auth.searchParams.get("scope"),
    "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload");
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
});

test("OAuth callback only matches the active login tab and exact origin/path", () => {
  const pending = { tabId: 10, redirect: "http://localhost:1457/auth/callback", startedAt: Date.now() };
  assert.equal(matchesCallback(pending, 10, "http://localhost:1457/auth/callback?code=abc&state=xyz"), true);
  assert.equal(matchesCallback(pending, 11, "http://localhost:1457/auth/callback?code=abc"), false);
  assert.equal(matchesCallback(pending, 10, "http://localhost:1458/auth/callback?code=abc"), false);
  assert.equal(matchesCallback(pending, 10, "http://localhost:1457/other?code=abc"), false);
});
