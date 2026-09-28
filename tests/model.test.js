import test from "node:test";
import assert from "node:assert/strict";
import { parseCodexUsage, parseCodexResetCredits, parseClaudeUsage, appendHistory, shortSummary, badgeSlides, orderedAccounts } from "../src/model.js";

test("Codex parses 5h and 7d windows", () => {
  const result = parseCodexUsage({ plan_type: "plus", rate_limit: {
    primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_at: 2_000_000_000 },
    secondary_window: { used_percent: 45, limit_window_seconds: 604800, reset_at: 2_000_000_000 } } });
  assert.deepEqual(result.metrics.map(m => m.title), ["5h", "7d"]);
  assert.equal(result.metrics[0].resetAt, 2_000_000_000_000);
  assert.match(shortSummary([{ provider: "codex", label: "a", metrics: result.metrics }]), /5h 80%.*7d 55%/);
});

test("Claude accepts dynamic model windows and ignores disabled windows", () => {
  const result = parseClaudeUsage({ five_hour: { utilization: 25, resets_at: "2030-01-01T00:00:00Z" },
    seven_day: { utilization: 10, is_enabled: false }, seven_day_opus: { utilization: 42 } });
  assert.deepEqual(result.metrics.map(m => m.title), ["5h", "7d Opus"]);
});

test("history stores changes and a 15-minute heartbeat", () => {
  const snapshot = { accountKey: "a", metrics: [{ id: "5h", title: "5h", used: 20, resetAt: 42 }] };
  const t = 2_000_000_000_000;
  let history = appendHistory([], snapshot, t);
  history = appendHistory(history, snapshot, t + 60_000);
  assert.equal(history.length, 1);
  history = appendHistory(history, snapshot, t + 16 * 60_000);
  assert.equal(history.length, 2);
});

test("Codex reset credits count and next expiry follow the provider payload", () => {
  const credits = parseCodexResetCredits({ available_count: 2, credits: [
    { status: "redeemed", expires_at: "2030-01-01T00:00:00Z" },
    { status: "available", expires_at: "2030-02-01T00:00:00Z" },
    { status: "available", expires_at: 1_893_456_000 }
  ] });
  assert.equal(credits.availableCount, 2);
  assert.equal(credits.available.length, 2);
  assert.equal(credits.available[0].expiresAt, 1_893_456_000_000);
  assert.equal(parseCodexResetCredits({ available_count: 0, credits: [] }).availableCount, 0);
});

test("badge slides use the first two accounts' exact 5h remaining percentages", () => {
  const accounts = { a: { accountKey: "a" }, b: { accountKey: "b" }, c: { accountKey: "c" } };
  const at = Date.now();
  const snapshot = used => ({ at, metrics: [{ title: "5h", used }] });
  assert.deepEqual(badgeSlides(accounts, { a: snapshot(29), b: snapshot(60), c: snapshot(99) }).map(slide => slide.text), ["71%", "40%"]);
  assert.deepEqual(badgeSlides(accounts, { a: snapshot(29) }).map(slide => slide.text), ["71%"]);
  assert.deepEqual(badgeSlides(accounts, { a: snapshot(0), b: snapshot(60) }).map(slide => slide.text), ["100%", "40%"]);
});

test("accounts retain first-added order and badge colors follow provider", () => {
  const accounts = {
    newer: { accountKey: "newer", provider: "claude", addedAt: 200 },
    older: { accountKey: "older", provider: "codex", addedAt: 100 }
  };
  const snapshots = { newer: { metrics: [{ title: "5h", used: 90 }] },
    older: { metrics: [{ title: "5h", used: 10 }] } };
  assert.deepEqual(orderedAccounts(accounts).map(account => account.accountKey), ["older", "newer"]);
  assert.deepEqual(badgeSlides(accounts, snapshots).map(slide => slide.color), ["#1d4ed8", "#d97706"]);
  const legacy = { newer: { accountKey: "newer" }, older: { accountKey: "older" } };
  const history = [{ accountKey: "older", at: 100 }, { accountKey: "newer", at: 200 }];
  assert.deepEqual(orderedAccounts(legacy, history).map(account => account.accountKey), ["older", "newer"]);
});
