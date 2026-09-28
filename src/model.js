export const PROVIDERS = { codex: "Codex", claude: "Claude" };
export const STORAGE = { accounts: "accounts", snapshots: "snapshots", history: "history", pending: "pendingLogin", errors: "errors" };
export const STALE_MS = 3 * 60_000;
export const HISTORY_GAP_MS = 30 * 60_000;
export const HISTORY_DAYS = 30;

export function property(value, ...names) {
  for (const name of names) if (value && Object.hasOwn(value, name)) return value[name];
  return undefined;
}

export function decodeJwt(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload));
  } catch { return null; }
}

export function codexIdentity(idToken) {
  const payload = decodeJwt(idToken) || {};
  const auth = payload["https://api.openai.com/auth"] || {};
  const profile = payload["https://api.openai.com/profile"] || {};
  return {
    accountId: property(auth, "chatgpt_account_id", "account_id"),
    label: profile.email || payload.email || profile.name || payload.name || "Codex account"
  };
}

function codexWindow(window, prefix = "") {
  const used = Number(property(window, "used_percent", "usedPercent"));
  const seconds = Number(property(window, "limit_window_seconds", "limitWindowSeconds"));
  const minutes = Number(property(window, "window_duration_mins", "windowDurationMins"));
  const duration = seconds > 0 ? Math.ceil(seconds / 60) : minutes;
  const reset = Number(property(window, "reset_at", "resetAt", "resets_at", "resetsAt"));
  if (!Number.isFinite(used) || !duration || !reset) return null;
  const title = duration === 300 ? "5h" : duration === 10080 ? "7d" :
    duration % 1440 === 0 ? `${duration / 1440}d` : `${duration / 60}h`;
  return { id: `${prefix}window-${duration}`, title: `${prefix ? `${prefix} ` : ""}${title}`,
    used: Math.max(0, Math.min(100, used)), resetAt: reset * 1000 };
}

export function parseCodexUsage(data) {
  const metrics = [];
  const add = (rate, prefix = "") => {
    for (const key of ["primary_window", "primaryWindow", "secondary_window", "secondaryWindow"])
      if (rate?.[key]) { const metric = codexWindow(rate[key], prefix); if (metric) metrics.push(metric); }
  };
  add(property(data, "rate_limit", "rateLimit"));
  add(property(data, "code_review_rate_limit", "codeReviewRateLimit"), "Code review");
  for (const [index, item] of (property(data, "additional_rate_limits", "additionalRateLimits") || []).entries())
    add(property(item, "rate_limit", "rateLimit"), item.limit_name || item.limitName || `Additional ${index + 1}`);
  if (!metrics.length && !data.credits && !property(data, "rate_limit", "rateLimit"))
    throw new Error("Codex response has no quota data");
  return { plan: property(data, "plan_type", "planType") || null,
    metrics: [...new Map(metrics.map(metric => [metric.id, metric])).values()] };
}

export function parseClaudeUsage(data) {
  if (!data || typeof data !== "object") throw new Error("Invalid Claude usage response");
  const labels = { five_hour: "5h", seven_day: "7d", seven_day_opus: "7d Opus", seven_day_sonnet: "7d Sonnet" };
  const metrics = Object.entries(data).filter(([, value]) => value && typeof value === "object" &&
    value.is_enabled !== false && Number.isFinite(Number(value.utilization))).map(([key, value]) => {
      const raw = property(value, "resets_at", "resetsAt");
      const resetAt = raw == null ? null : typeof raw === "number" ? raw * 1000 : Date.parse(raw);
      return { id: `claude-${key}`, title: labels[key] || key.replaceAll("_", " "),
        used: Math.max(0, Math.min(100, Number(value.utilization))),
        resetAt: Number.isFinite(resetAt) ? resetAt : null };
    });
  const rank = id => { const index = Object.keys(labels).indexOf(id.slice(7)); return index < 0 ? 4 : index; };
  return { plan: null, metrics: metrics.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id)) };
}

function parseFlexibleDate(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric) ? (numeric > 10_000_000_000 ? numeric : numeric * 1000) : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function parseCodexResetCredits(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid reset credits response");
  const credits = (Array.isArray(data.credits) ? data.credits : []).map(credit => ({
    status: String(credit.status || "unknown"),
    resetType: String(property(credit, "reset_type", "resetType") || "codex_rate_limits"),
    expiresAt: parseFlexibleDate(property(credit, "expires_at", "expiresAt"))
  }));
  const available = credits.filter(credit => credit.status.trim().toLowerCase() === "available")
    .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
  const reported = Number(property(data, "available_count", "availableCount"));
  if (!Number.isFinite(reported) && !Array.isArray(data.credits)) throw new Error("Reset credits count missing");
  return { availableCount: Math.max(Number.isFinite(reported) ? reported : 0, available.length), available };
}

export function appendHistory(history, snapshot, now = Date.now()) {
  const cutoff = now - HISTORY_DAYS * 86_400_000;
  const existing = history.filter(row => row.at >= cutoff);
  for (const metric of snapshot.metrics) {
    const previous = [...existing].reverse().find(row => row.accountKey === snapshot.accountKey && row.metricId === metric.id);
    if (!previous || previous.used !== metric.used || previous.resetAt !== metric.resetAt || now - previous.at >= 15 * 60_000)
      existing.push({ accountKey: snapshot.accountKey, metricId: metric.id, at: now,
        used: metric.used, resetAt: metric.resetAt, title: metric.title });
  }
  return existing;
}

export function shortSummary(snapshots) {
  return snapshots.flatMap(snapshot => {
    const five = snapshot.metrics.find(metric => metric.title === "5h");
    const week = snapshot.metrics.find(metric => metric.title === "7d");
    return `${PROVIDERS[snapshot.provider]} ${snapshot.label}: ` +
      [five && `5h ${Math.round(100 - five.used)}%`, week && `7d ${Math.round(100 - week.used)}%`].filter(Boolean).join(" · ");
  }).join("\n") || "LLM Usage — click to sign in";
}

export function orderedAccounts(accounts, history = []) {
  const earliest = new Map();
  for (const row of history) if (Number.isFinite(row.at))
    earliest.set(row.accountKey, Math.min(earliest.get(row.accountKey) ?? Infinity, row.at));
  return Object.values(accounts).map((account, index) => ({ account, index,
    addedAt: Number.isFinite(account.addedAt) ? account.addedAt : earliest.get(account.accountKey) ?? Infinity }))
    .sort((a, b) => a.addedAt - b.addedAt || a.index - b.index).map(item => item.account);
}

export function badgeSlides(accounts, snapshots, history = []) {
  return orderedAccounts(accounts, history).slice(0, 2).map(account => {
    const snapshot = snapshots[account.accountKey];
    const metric = snapshot?.metrics?.find(item => item.title === "5h");
    if (!metric) return null;
    const remaining = Math.max(0, Math.min(100, Math.round(100 - metric.used)));
    const color = account.provider === "claude" ? "#d97706" : "#1d4ed8";
    return { text: `${remaining}%`, color };
  }).filter(Boolean);
}
