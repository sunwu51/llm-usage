import { HISTORY_GAP_MS, PROVIDERS, orderedAccounts } from "./model.js";
const $ = selector => document.querySelector(selector);
let data;
function option(value, label) { const node = document.createElement("option"); node.value = value; node.textContent = label; return node; }
function fillAccounts() {
  const select = $("#account"), previous = select.value;
  select.replaceChildren(...orderedAccounts(data.accounts || {}, data.history || []).map(a => option(a.accountKey, `${PROVIDERS[a.provider]} · ${a.label}`)));
  if (previous && [...select.options].some(o => o.value === previous)) select.value = previous;
  fillMetrics();
}
function fillMetrics() {
  const select = $("#metric"), previous = select.value;
  const key = $("#account").value;
  const metrics = new Map((data.history || []).filter(row => row.accountKey === key).map(row => [row.metricId, row.title]));
  select.replaceChildren(...[...metrics].map(([id, title]) => option(id, title)));
  if (previous && metrics.has(previous)) select.value = previous;
  draw();
}
function svg(name, attrs) { const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; }
function draw() {
  const chart = $("#chart"); chart.replaceChildren();
  const now = Date.now(), start = now - Number($("#range").value) * 86_400_000;
  const rows = (data.history || []).filter(row => row.accountKey === $("#account").value &&
    row.metricId === $("#metric").value && row.at >= start).sort((a, b) => a.at - b.at);
  const x = at => 45 + (at - start) / (now - start) * 820;
  const y = used => 275 - used / 100 * 240;
  for (const percent of [0, 25, 50, 75, 100]) {
    chart.append(svg("line", { x1: 45, x2: 865, y1: y(percent), y2: y(percent), class: "grid" }));
    const label = svg("text", { x: 5, y: y(percent) + 4, class: "chart-label" }); label.textContent = `${percent}%`; chart.append(label);
  }
  let segment = [];
  function flush() { if (segment.length > 1) chart.append(svg("polyline", { points: segment.map(row => `${x(row.at)},${y(row.used)}`).join(" "), class: "line" })); segment = []; }
  for (const row of rows) {
    if (segment.length && (row.at - segment.at(-1).at > HISTORY_GAP_MS || row.resetAt !== segment.at(-1).resetAt)) flush();
    segment.push(row);
    chart.append(svg("circle", { cx: x(row.at), cy: y(row.used), r: 3, class: "point" }));
  }
  flush();
  $("#from").textContent = new Date(start).toLocaleString(); $("#to").textContent = new Date(now).toLocaleString();
  $("#summary").textContent = rows.length ? `${rows.length} samples · Latest ${Math.round(rows.at(-1).used)}% used · Last sample ${new Date(rows.at(-1).at).toLocaleString()}` : "No history yet";
  $("#empty").textContent = rows.length ? "Line breaks mark missed samples or usage window resets. Dots are actual samples." : "Connect an account and complete a usage check to start recording.";
}
$("#account").addEventListener("change", fillMetrics);
$("#metric").addEventListener("change", draw);
$("#range").addEventListener("change", draw);
$("#export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), history: data.history || [] }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = "llm-usage-history.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
chrome.storage.onChanged.addListener(() => { void load(); });
async function load() { data = await chrome.storage.local.get(["accounts", "history"]); fillAccounts(); }
void load();
