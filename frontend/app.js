// DashCheckLive frontend. Plain JS, no build step.
// All server/customer text is rendered with textContent, never innerHTML.
// The session token lives in sessionStorage: per-tab, cleared when the tab closes.

const $ = (sel) => document.querySelector(sel);

const state = {
  session: null,      // {token, user_id, role}
  storeName: "",
  orders: [],
  current: null,      // full order from /api/orders/:id
  overrides: {},      // orderId -> {label: reason}
  checklistKey: "",
  stream: null,
  camOn: false,
  photoMode: false,
  lastResult: null,
  lastToken: null,
  healthTimer: null,
};

// ---------------- helpers ----------------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(node, rest);
  if (dataset) Object.assign(node.dataset, dataset); // node.dataset itself is read-only
  for (const c of children) if (c != null) node.append(c);
  return node;
}

async function api(path, { token, method = "GET", json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(path, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    const err = new Error(typeof d === "string" ? d : (d && d.message) || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = d && d.code;
    throw err;
  }
  return data;
}

function authed(path, opts = {}) {
  return api(path, { ...opts, token: state.session && state.session.token }).catch((e) => {
    if (e.status === 401) signOut("Session expired. Sign in again.");
    throw e;
  });
}

function show(view) {
  for (const v of ["#view-login", "#view-station", "#view-done", "#view-dasher"]) $(v).classList.toggle("hidden", v !== view);
}

function money(n) { return `$${n.toFixed(2)}`; }

// ---------------- sign in / out ----------------

// Demo accounts (PINs are public demo values, also listed in the README).
const DEMO_ACCOUNTS = [
  { id: "staff-olivia", pin: "4242", role: "staff", name: "Olivia", icon: "🧑‍🍳" },
  { id: "staff-jordan", pin: "1357", role: "staff", name: "Jordan", icon: "🧑‍🍳" },
  { id: "dasher-ava", pin: "1111", role: "dasher", name: "Ava", icon: "🛵" },
  { id: "dasher-ben", pin: "2222", role: "dasher", name: "Ben", icon: "🛵" },
  { id: "dasher-cy", pin: "3333", role: "dasher", name: "Cy", icon: "🛵" },
  { id: "dasher-dee", pin: "4444", role: "dasher", name: "Dee", icon: "🛵" },
];
const ROLE_HELP = {
  staff: ["Check and seal orders at your packing station.", "staff-olivia"],
  dasher: ["Confirm a pickup with the code from the counter.", "dasher-ava"],
};
let loginRole = "staff";

function setLoginRole(role) {
  loginRole = role;
  for (const b of document.querySelectorAll(".role-toggle button")) {
    const on = b.dataset.role === role;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  }
  $("#role-help").textContent = ROLE_HELP[role][0];
  $("#login-id").placeholder = ROLE_HELP[role][1];
  $("#quick-accounts").replaceChildren(...DEMO_ACCOUNTS.filter((a) => a.role === role).map((a) => {
    const b = el("button", { type: "button", className: "quick-btn" },
      el("span", { className: "q-ico", textContent: a.icon }),
      el("span", {}, el("strong", { textContent: a.name }), el("small", { textContent: a.id })));
    b.addEventListener("click", () => {
      $("#login-id").value = a.id;
      $("#login-pin").value = a.pin;
      $("#login-form").requestSubmit();
    });
    return b;
  }));
}
for (const b of document.querySelectorAll(".role-toggle button")) b.addEventListener("click", () => setLoginRole(b.dataset.role));

// Typing an ID switches the toggle to match.
$("#login-id").addEventListener("input", (e) => {
  const v = e.target.value.trim().toLowerCase();
  if (v.startsWith("dasher") && loginRole !== "dasher") setLoginRole("dasher");
  else if (v.startsWith("staff") && loginRole !== "staff") setLoginRole("staff");
});

$("#pin-eye").addEventListener("click", () => {
  const pin = $("#login-pin");
  const show = pin.type === "password";
  pin.type = show ? "text" : "password";
  $("#pin-eye").textContent = show ? "Hide" : "Show";
  $("#pin-eye").setAttribute("aria-label", show ? "Hide PIN" : "Show PIN");
});

function loginMessage(text, kind = "error") {
  const m = $("#login-error");
  m.textContent = text;
  m.className = `login-msg ${text ? kind : ""}`;
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = $("#login-btn");
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = "Signing in…";
  loginMessage("");
  try {
    const userId = f.get("user_id").trim();
    const s = await api("/api/auth/login", { method: "POST", json: { user_id: userId, pin: f.get("pin") } });
    // Remember the ID (never the PIN) on this device for next time.
    try { localStorage.setItem("dcl-last-id", userId); } catch {}
    e.target.reset();
    $("#login-pin").type = "password";
    $("#pin-eye").textContent = "Show";
    startSession(s);
  } catch (err) {
    loginMessage(err.message, err.status === 429 ? "warn" : "error");
    $("#login-pin").select();
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});

// Small looping preview on the sign-in page: an item goes 0/1 → detected → ✓.
const PREVIEW_ITEMS = ["bottle", "salad", "energy drink", "fork", "tofu", "spoon"];
let previewIdx = 0;
function runPreview() {
  if ($("#view-login").classList.contains("hidden")) return setTimeout(runPreview, 1500);
  const label = PREVIEW_ITEMS[previewIdx++ % PREVIEW_ITEMS.length];
  const name = label.charAt(0).toUpperCase() + label.slice(1);
  const card = $(".preview-card");
  $("#pv-icon").replaceChildren(KAWAII(label) || "🍽️");
  $("#pv-name").textContent = name;
  $("#pv-count").textContent = "0/1";
  $("#pv-badge").textContent = "✗";
  card.classList.remove("ok");
  $("#pv-toast").classList.remove("show");
  setTimeout(() => {
    $("#pv-toast").textContent = `${name} detected!`;
    $("#pv-toast").classList.add("show");
    $("#pv-count").textContent = "1/1";
    $("#pv-badge").textContent = "✓";
    card.classList.add("ok");
  }, 1400);
  setTimeout(runPreview, 3600);
}

function showLogin(message = "", kind = "error") {
  show("#view-login");
  let last = "";
  try { last = localStorage.getItem("dcl-last-id") || ""; } catch {}
  setLoginRole(last.startsWith("dasher") ? "dasher" : "staff");
  $("#login-id").value = last;
  loginMessage(message, kind);
  (last ? $("#login-pin") : $("#login-id")).focus();
}

function startSession(s) {
  state.session = s;
  try { sessionStorage.setItem("dcl-session", JSON.stringify(s)); } catch {}
  if (s.role === "merchant_staff") enterStation();
  else enterDasher();
}

function signOut(message = "") {
  stopCamera();
  clearTimeout(state.healthTimer);
  state.session = null;
  state.current = null;
  try { sessionStorage.removeItem("dcl-session"); } catch {}
  $("#log-drawer").classList.add("hidden");
  $("#next-pop").classList.add("hidden");
  if (location.hash) history.replaceState(null, "", location.pathname);
  showLogin(message, message.startsWith("Session expired") ? "notice" : "error");
}
$("#logout").addEventListener("click", () => signOut());
$("#dasher-logout").addEventListener("click", () => signOut());

// ---------------- station ----------------

async function enterStation() {
  show("#view-station");
  $("#who").textContent = state.session.user_id;
  pollHealth();
  await refreshQueue();
  startCamera();
}

async function pollHealth() {
  clearTimeout(state.healthTimer);
  const h = await api("/api/health").catch(() => null);
  if (!h) return;
  const v = h.vision;
  const d = v.local;
  state.frameInterval = v.frame_interval_ms;
  let text, cls;
  if (v.backend === "openrouter") { text = `Vision: OpenRouter ${v.model}`; cls = "ok"; }
  else if (d.state === "ready") { text = `Vision: local ${d.backends.join(" + ")}`; cls = "ok"; }
  else if (d.state === "loading") { text = "Vision: loading local models…"; cls = "warn"; }
  else { text = `Vision: ${d.state}`; cls = "bad"; }
  const fallback = v.backend === "openrouter" && v.fallback === "local"
    ? el("span", { className: `pill ${d.state === "ready" ? "ok" : "warn"}`, textContent: `Backup: local YOLO ${d.state}` })
    : null;
  $("#health").replaceChildren(...[
    el("span", { className: `pill ${cls}`, textContent: text, title: v.warning || JSON.stringify(d.errors || {}) }),
    fallback,
    el("span", { className: `pill ${h.parser.startsWith("openrouter") ? "ok" : "warn"}`, textContent: `Notes: ${h.parser}` }),
    v.images_leave_device
      ? el("span", { className: "pill warn", textContent: "Frames sent to OpenRouter (no-retention providers)" })
      : el("span", { className: "pill ok", textContent: "Images stay on device" }),
  ].filter(Boolean));
  if (d.state === "loading" || d.state === "idle") state.healthTimer = setTimeout(pollHealth, 3000);
}

const STATUS_TEXT = { new: "New", prepared: "Checking", sealed: "Sealed", picked_up: "Completed" };

async function refreshQueue() {
  const r = await authed("/api/orders");
  state.orders = r.orders;
  $("#store-name").textContent = r.store;
  const waiting = r.orders.filter((o) => o.status === "new" || o.status === "prepared");
  $("#queue-sub").textContent = `${waiting.length} waiting · ${r.orders.length} today`;
  renderQueue();
}

// Left panel: searchable order list (food icon, name, status, city).
function renderQueue() {
  const q = ($("#search").value || "").trim().toLowerCase();
  const rows = state.orders.filter((o) =>
    !q || `${o.id} ${o.display_name} ${o.ref} ${o.delivery_city} ${o.dasher_name}`.toLowerCase().includes(q));
  $("#queue").replaceChildren(...rows.map((o) => {
    const li = el("li", { className: `order-item${state.current && state.current.id === o.id ? " active" : ""}` },
      el("span", { className: "avatar" }, KAWAII(o.labels[0]) || "🍽️"),
      el("div", { className: "oi-main" },
        el("div", { className: "oi-top" },
          el("strong", { textContent: o.display_name }),
          el("span", { className: "oi-id", textContent: `#${o.id}` })),
        el("div", { className: "oi-city", textContent: `⌖ ${o.delivery_city}` })),
      el("span", { className: `status-pill ${o.status}`, textContent: STATUS_TEXT[o.status] || o.status }));
    li.addEventListener("click", () => openOrder(o.id));
    return li;
  }));
  if (!rows.length) $("#queue").replaceChildren(el("li", { className: "muted empty-note", textContent: "No orders match your search." }));
}
$("#search").addEventListener("input", renderQueue);

$("#demo-reset").addEventListener("click", async () => {
  await authed("/api/demo/reset", { method: "POST" });
  for (const k of Object.keys(seenCounts)) delete seenCounts[k];
  state.current = null;
  state.overrides = {};
  clearOverlay();
  renderSide();
  await refreshQueue();
  refreshLog();
});

// ---------------- order ----------------

async function openOrder(id) {
  state.checklistKey = "";
  state.lastResult = null;
  clearOverlay();
  if (state.photoMode) backToLive();
  let o = await authed(`/api/orders/${encodeURIComponent(id)}`);
  state.current = o;
  renderReceipt();
  renderSide();
  refreshQueue();
  if (o.status === "new") {
    // Scrub the note and build the checklist straight away: one tap for staff.
    $("#checklist").replaceChildren(el("p", { className: "muted", textContent: "Removing personal info and reading the note…" }));
    try {
      o = await authed(`/api/orders/${encodeURIComponent(id)}/prepare`, { method: "POST" });
      if (state.current && state.current.id === id) {
        state.current = o;
        renderReceipt();
        renderSide();
      }
      refreshQueue();
      refreshLog();
    } catch (e) {
      $("#checklist").replaceChildren(el("p", { className: "error", textContent: e.message }));
    }
  }
}

// Right panel: delivery address card + cart (one line per receipt item with a ✓/✗ chip).
function renderReceipt() {
  const o = state.current;
  $("#right-empty").classList.toggle("hidden", !!o);
  $("#right-content").classList.toggle("hidden", !o);
  if (!o) return;
  const r = o.receipt;
  const placed = new Date(o.placed_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("#addr-line").textContent = o.delivery_address || `${o.delivery_city} (full address after sealing)`;
  $("#addr-meta").textContent = `Placed ${placed} · Dasher ${o.dasher_name}`;
  $("#cart-id").textContent = `Order ID: #${o.id}`;

  const mode = o.status === "sealed" || o.status === "picked_up" ? "check"
    : o.fulfillment.toLowerCase().startsWith("pickup") ? "pickup" : "delivery";
  for (const s of document.querySelectorAll(".mode-toggle span")) s.classList.toggle("on", s.dataset.mode === mode);

  // The cart is where item status shows now: ✓ when counted, "detected/expected" when not.
  const byLabel = Object.fromEntries((o.checklist || []).map((i) => [i.label, i]));
  const rowOk = (row) => (o.status !== "new" && row && row.status === "ok" ? "1" : "0");
  const chip = (row) => {
    const s = o.status === "new" || !row ? "wait" : row.status === "ok" ? "ok" : "no";
    const text = s === "ok" ? "✓" : s === "wait" ? "…" : row.expected === 0 ? "remove" : `${row.detected}/${row.expected}`;
    return el("span", { className: `cart-chip ${s}`, textContent: text });
  };
  const lines = r.lines.map((l) => el("div", { className: "cart-line", dataset: { ok: rowOk(byLabel[l.detect]), key: l.detect } },
    el("span", { className: "cart-img" }, KAWAII(l.detect) || "🍽️"),
    el("div", { className: "cart-info" },
      el("strong", { textContent: l.name }),
      el("div", { className: "cart-sub", textContent: l.modifiers.join(" · ") || money(l.total) }),
      el("div", { className: "qty" }, el("span", { className: "q-btn", textContent: "−" }), el("span", { textContent: String(l.qty) }),
        el("span", { className: "q-btn", textContent: "+" }))),
    chip(byLabel[l.detect])));
  // Extras added by the note or modifiers (e.g. a ranch cup) and items to leave out.
  const onReceipt = new Set(r.lines.map((l) => l.detect));
  for (const row of o.checklist || []) {
    if (onReceipt.has(row.label)) continue;
    lines.push(el("div", { className: "cart-line", dataset: { ok: rowOk(row), key: row.label } },
      el("span", { className: "cart-img" }, KAWAII(row.label) || "🍽️"),
      el("div", { className: "cart-info" },
        el("strong", { textContent: row.label.charAt(0).toUpperCase() + row.label.slice(1) }),
        el("div", { className: "cart-sub", textContent: row.expected === 0 ? "Customer asked to leave out" : `Extra from ${row.source}` }),
        el("div", { className: "qty", textContent: row.expected === 0 ? "" : `Qty ${row.expected}` })),
      chip(row)));
  }
  // Still-missing items first; detected (✓) items sink below them. Stable sort keeps receipt order within each group.
  lines.sort((a, b) => Number(a.dataset.ok) - Number(b.dataset.ok));
  // Animate the move (FLIP): remember where each line was, re-render, then slide from old to new spot.
  const box = $("#receipt");
  const before = new Map([...box.children].map((n) => [n.dataset.key, { top: n.getBoundingClientRect().top, ok: n.dataset.ok }]));
  box.replaceChildren(...lines);
  for (const n of box.children) {
    const prev = before.get(n.dataset.key);
    if (!prev) continue;
    if (prev.ok === "0" && n.dataset.ok === "1") n.classList.add("just-detected");
    const dy = prev.top - n.getBoundingClientRect().top;
    if (dy && n.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      n.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 550, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  }

  const red = Object.entries(o.redactions || {}).map(([k, n]) => `${n}× ${k}`).join(", ");
  $("#note-text").textContent = o.status === "new" ? "Removing personal info…" : (o.note || "No note");
  $("#note-redact").textContent = red ? `Removed before AI: ${red}` : "";
  $("#t-sub").textContent = money(r.subtotal);
  $("#t-tax").textContent = money(r.tax);
  $("#t-total").textContent = money(r.total);
}

function renderSide() {
  const o = state.current;
  const parsed = (o && o.parsed) || {};
  const allergy = $("#allergy");
  if ((parsed.allergy_flags || []).length) {
    allergy.textContent = `⚠ ALLERGY: ${parsed.allergy_flags.join(", ").toUpperCase()}`;
    allergy.classList.remove("hidden");
  } else allergy.classList.add("hidden");

  const prep = $("#prep");
  if ((parsed.prep_instructions || []).length) {
    prep.replaceChildren(el("div", { className: "label", textContent: "Check by hand (camera can't see these)" }),
      ...parsed.prep_instructions.map((p) => el("div", { textContent: `• ${p}` })));
    prep.classList.remove("hidden");
  } else prep.classList.add("hidden");

  $("#seal-box").classList.toggle("hidden", !o || o.status !== "prepared");
  $("#recount").classList.toggle("hidden", !o || o.status !== "prepared");
  $("#confirm").checked = false;
  $("#seal-error").textContent = "";

  const done = $("#done-box");
  done.classList.add("hidden");
  renderReceipt();
  if (!o) {
    $("#checklist").replaceChildren(el("p", { className: "muted empty-note", textContent: "Pick an order from the list on the left." }));
    $("#checklist-sub").textContent = "Items appear here once an order is open";
    $("#check-sub").textContent = "Pick an order to start";
    setBanner(null);
    updateStageMsg();
    return;
  }
  $("#check-sub").textContent = `Order #${o.id} · ${o.display_name} · ${STATUS_TEXT[o.status] || o.status}`;
  if (o.status === "sealed" || o.status === "picked_up") {
    $("#checklist").replaceChildren(el("p", { className: "muted empty-note", textContent: "This order is sealed. Pick the next one on the left." }));
    $("#checklist-sub").textContent = o.status === "sealed" ? "Sealed, waiting for Dasher" : "Picked up ✓";
    const s = o.seal || {};
    done.replaceChildren(
      el("strong", { textContent: o.status === "sealed" ? "Sealed, waiting for Dasher" : "Picked up ✓" }),
      el("div", { className: "small muted", textContent: `Sealed by ${s.staff_id || "-"} · vision agreed: ${s.vision_all_ok ? "yes" : "no"}` }),
      ...Object.entries(s.overrides || {}).map(([k, v]) => el("div", { className: "small", textContent: `Override ${k}: ${v}` })));
    done.classList.remove("hidden");
    setBanner(null);
  } else if (o.status === "prepared") {
    renderChecklist(o.checklist || [], true);
  }
  updateStageMsg();
}

// ---------------- checklist + seal ----------------

const whyText = {
  missing: (i) => `Add ${i.expected - i.detected} more`,
  check: () => "Low confidence. Look closely",
  unexpected: () => "Customer asked to leave this out",
};

// Cute icon per checklist label (emoji: no image files, CSP-friendly).
const FOOD_ICONS = {
  "bottle": "🥤", "can": "🥫", "energy drink": "⚡", "sandwich": "🥪", "hot dog": "🌭",
  "pizza": "🍕", "donut": "🍩", "apple": "🍎", "banana": "🍌", "orange": "🍊",
  "sauce cup": "🥣", "fork": "🍴", "spoon": "🥄", "knife": "🔪", "tofu": "🧈", "salad": "🥗",
};
const prevStatus = {}; // "orderId:label" -> last status, to pop only on the change to ok

function foodIcon(item, orderId) {
  const key = `${orderId}:${item.label}`;
  const justOk = item.status === "ok" && prevStatus[key] && prevStatus[key] !== "ok";
  prevStatus[key] = item.status;
  const span = el("span", { className: `food-icon ${item.status}${justOk ? " just-ok" : ""}`, ariaHidden: "true" });
  // Kawaii illustration if we drew one (icons.js), emoji otherwise.
  span.append(KAWAII(item.label) || (FOOD_ICONS[item.label] || "🍽️"));
  return span;
}

function overridesFor(id) {
  return (state.overrides[id] = state.overrides[id] || {});
}

function renderChecklist(items, force = false) {
  const o = state.current;
  if (!o || o.status !== "prepared") return;
  o.checklist = items;
  setBanner(items);
  const key = JSON.stringify(items.map((i) => [i.label, i.detected, i.status]));
  if (!force && key === state.checklistKey) return updateSealButton();
  state.checklistKey = key;

  const ov = overridesFor(o.id);
  const ul = el("ul", { className: "food-grid" });
  for (const i of items) {
    const count = i.expected === 0 ? (i.detected ? "in view" : "left out") : `${i.detected}/${i.expected}`;
    const badge = i.status === "ok" ? "✓" : "✗";
    const card = el("li", { className: `food-card ${i.status}` },
      el("span", { className: `badge ${i.status}`, textContent: badge, title: i.status }),
      el("div", { className: "float-wrap" }, foodIcon(i, o.id), el("div", { className: "float-shadow" })),
      el("div", { className: "name", textContent: i.label }),
      el("div", { className: "count-big", textContent: count }),
      i.source !== "menu" ? el("div", { className: "src", textContent: `from ${i.source}` }) : null,
      whyText[i.status] ? el("div", { className: "why", textContent: whyText[i.status](i) })
        : i.low_conf ? el("div", { className: "why", textContent: "Low confidence" }) : null);
    if (i.status !== "ok") {
      const input = el("input", { placeholder: "Reason (optional)", value: ov[i.label] || "", maxLength: 120 });
      input.addEventListener("input", () => { ov[i.label] = input.value; updateSealButton(); });
      card.append(input);
    }
    ul.append(card);
  }
  $("#checklist").replaceChildren(ul);
  const okN = items.filter((i) => i.status === "ok").length;
  $("#checklist-sub").textContent = `${okN} of ${items.length} items detected`;
  $("#check-sub").textContent = `Order #${o.id} · ${okN} of ${items.length} items detected`;
  renderReceipt(); // refresh the ✓/✗ chips in the cart
  updateSealButton();
}

function setBanner(items) {
  const b = $("#banner");
  if (!items || !items.length || !state.lastResult) { b.classList.add("hidden"); return; }
  // Only the success banner shows over the camera; what's missing is in the checklist panel.
  if (items.every((i) => i.status === "ok")) {
    b.textContent = "✓ All items present. Confirm & seal";
    b.className = "banner ok";
  } else {
    b.classList.add("hidden");
  }
}

// Staff can always finish an order once they tick "I'm done". Rows the camera
// didn't match are sealed as overrides: a typed reason if given, otherwise a
// default one. Either way the server records each override in the audit log.
const DEFAULT_OVERRIDE = "Staff confirmed; camera did not match";

function updateSealButton() {
  const o = state.current;
  if (!o || o.status !== "prepared") return;
  const notOk = (o.checklist || []).filter((i) => i.status !== "ok").length;
  const btn = $("#seal");
  btn.disabled = !$("#confirm").checked;
  btn.textContent = notOk
    ? `Seal anyway · ${notOk} override${notOk > 1 ? "s" : ""} →`
    : "Seal & release to Dasher →";
}
$("#confirm").addEventListener("change", updateSealButton);

$("#seal").addEventListener("click", async () => {
  const o = state.current;
  $("#seal-error").textContent = "";
  const ov = overridesFor(o.id);
  const overrides = {};
  for (const i of o.checklist || []) {
    if (i.status === "ok") continue;
    const typed = (ov[i.label] || "").trim();
    overrides[i.label] = typed.length >= 3 ? typed : DEFAULT_OVERRIDE;
  }
  try {
    const r = await authed(`/api/orders/${o.id}/seal`, {
      method: "POST",
      json: { confirmed: $("#confirm").checked, prep_acknowledged: $("#confirm").checked, overrides },
    });
    state.current = r.order;
    state.lastToken = r.pickup_token;
    clearOverlay();
    renderSide();
    stopCamera();
    await showSealPop(r.order);
    await refreshQueue().catch(() => {});
    showNextPicker(r.order);
    refreshLog();
  } catch (e) {
    $("#seal-error").textContent = e.message;
  }
});

// After the sealed moment: a pop-up listing waiting orders to pick from.
function showNextPicker(sealed) {
  const waiting = state.orders.filter((o) => o.id !== sealed.id && (o.status === "new" || o.status === "prepared"));
  $("#next-pop-sub").textContent = waiting.length
    ? `#${sealed.id} is sealed for ${sealed.dasher_name}. ${waiting.length} order${waiting.length === 1 ? "" : "s"} waiting.`
    : `#${sealed.id} is sealed for ${sealed.dasher_name}.`;
  const list = $("#next-pop-list");
  if (!waiting.length) {
    list.replaceChildren(el("li", { className: "caught-up", textContent: "All caught up 🎉 No orders waiting." }));
  } else {
    list.replaceChildren(...waiting.map((o) => {
      const li = el("li", { className: "next-card" },
        el("div", { className: "mini-icons" },
          ...o.labels.slice(0, 4).map((l) => el("span", { className: "mini-icon" }, KAWAII(l) || "🍽️"))),
        el("div", { className: "next-info" },
          el("strong", { textContent: `#${o.id} ${o.display_name}` }),
          el("div", { className: "small muted", textContent: `${o.item_count} item${o.item_count === 1 ? "" : "s"} · ${o.delivery_city} · ${o.dasher_name}` })),
        el("span", { className: `status-pill ${o.status}`, textContent: STATUS_TEXT[o.status] || o.status }));
      li.addEventListener("click", () => { closeNextPicker(); openOrder(o.id); });
      return li;
    }));
  }
  $("#next-pop").classList.remove("hidden");
}

function closeNextPicker() {
  $("#next-pop").classList.add("hidden");
  startCamera($("#camera-select").value || undefined);
}
$("#next-pop-close").addEventListener("click", closeNextPicker);

// Full-screen "Order #50 sealed ✓" moment before picking the next order.
function showSealPop(o) {
  $("#seal-pop-title").textContent = `Order #${o.id} sealed`;
  $("#seal-pop-sub").textContent = `${o.display_name} · releasing to ${o.dasher_name}`;
  const pop = $("#seal-pop");
  pop.classList.remove("hidden", "leaving");
  return new Promise((resolve) => setTimeout(() => {
    pop.classList.add("leaving");
    setTimeout(() => { pop.classList.add("hidden"); resolve(); }, 300);
  }, 1700));
}

$("#recount").addEventListener("click", async () => {
  const o = state.current;
  if (!o || o.status !== "prepared") return;
  try {
    state.current = await authed(`/api/orders/${o.id}/recount`, { method: "POST" });
    delete seenCounts[o.id];
    state.checklistKey = "";
    clearOverlay();
    renderSide();
    refreshLog();
  } catch (e) {
    $("#seal-error").textContent = e.message;
  }
});

// ---------------- QR modal + simulated Dasher scan ----------------

async function openQrModal(r) {
  const o = r.order;
  $("#done-address").textContent = o.delivery_address || o.delivery_city;
  $("#qr").src = r.qr_png;
  $("#qr-ttl").textContent = `${Math.round(r.expires_in / 60)} min`;
  $("#sim-dasher").value = o.dasher_id;
  $("#sim-pin").value = "";
  $("#sim-result").textContent = "";
  $("#sim-result").className = "sim-result";
  renderNextSteps(o);
  renderCompletedReceipt(o);
  // Separate page: camera off, own history entry so the browser Back button returns.
  stopCamera();
  $("#log-drawer").classList.add("hidden");
  show("#view-done");
  history.pushState({ view: "done" }, "", "#complete");
  window.scrollTo(0, 0);
  await refreshQueue().catch(() => {});
  renderNextOrders(o.id);
}

function closeDone(fromPopState = false) {
  if ($("#view-done").classList.contains("hidden")) return;
  show("#view-station");
  if (!fromPopState && location.hash === "#complete") history.back();
  startCamera($("#camera-select").value || undefined);
}
$("#qr-close-x").addEventListener("click", () => closeDone());
window.addEventListener("popstate", () => closeDone(true));

function renderNextSteps(o) {
  const items = o.receipt.lines.reduce((n, l) => n + l.qty, 0);
  const steps = [
    ["Bag it", "Put the checked items in the bag and seal it."],
    ["Label it", `Write or stick on the bag: #${o.id} · ${o.display_name} · ${items} item${items === 1 ? "" : "s"}.`],
    ["Shelf it", "Place the bag on the pickup shelf."],
    ["Hand it off", `${o.dasher_name} scans the pickup QR below. Only they can take it.`],
  ];
  $("#next-steps").replaceChildren(...steps.map(([title, text], idx) => {
    const done = idx === 3 && o.status === "picked_up";
    const li = el("li", { className: done ? "done" : "" },
      el("span", { className: "tick", textContent: done ? "✓" : String(idx + 1) }),
      el("div", {}, el("strong", { textContent: title }), el("div", { className: "small muted", textContent: text })));
    // Staff can tap steps off as they go (local only).
    li.addEventListener("click", () => {
      li.classList.toggle("done");
      li.querySelector(".tick").textContent = li.classList.contains("done") ? "✓" : String(idx + 1);
    });
    return li;
  }));
}

function renderCompletedReceipt(o) {
  const r = o.receipt;
  const seal = o.seal || {};
  const byLabel = Object.fromEntries((o.checklist || []).map((i) => [i.label, i]));
  const sealedAt = seal.ts ? new Date(seal.ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

  const verify = (label) => {
    const row = byLabel[label];
    if (seal.overrides && seal.overrides[label]) return el("span", { className: "v v-over", textContent: "✋ staff" });
    if (row && row.status === "ok") return el("span", { className: "v v-ok", textContent: "📷 ✓" });
    return el("span", { className: "v v-over", textContent: "✋ staff" });
  };

  const lines = [];
  for (const l of r.lines) {
    lines.push(el("div", { className: "dr-line" },
      el("span", { className: "dr-icon" }, KAWAII(l.detect) || ""),
      el("span", { className: "dr-name" }, el("strong", { textContent: `${l.qty}× ${l.name}` }),
        ...l.modifiers.map((m) => el("div", { className: "r-mod", textContent: m }))),
      verify(l.detect),
      el("span", { className: "dr-price", textContent: money(l.total) })));
  }
  // Extras the customer's note or modifiers added (no price line of their own).
  const extras = (o.checklist || []).filter((i) => i.source !== "menu" && i.expected > 0);
  for (const i of extras) {
    lines.push(el("div", { className: "dr-line extra" },
      el("span", { className: "dr-icon" }, KAWAII(i.label) || ""),
      el("span", { className: "dr-name", textContent: `${i.expected}× ${i.label} (from ${i.source})` }),
      verify(i.label),
      el("span", { className: "dr-price", textContent: "" })));
  }
  const overrides = Object.entries(seal.overrides || {});

  $("#done-receipt").replaceChildren(
    el("div", { className: "dr-head" },
      el("div", { className: "dr-store", textContent: o.store }),
      el("div", { className: "dr-big", textContent: `#${o.id} · ${o.display_name}` }),
      el("div", { className: "r-muted", textContent: `${o.ref} · ${o.fulfillment} · sealed ${sealedAt}` }),
      el("div", { className: "dr-stamp", textContent: "VERIFIED & SEALED" })),
    el("hr"),
    ...lines,
    el("hr"),
    el("div", { className: "r-line" }, el("span", { textContent: "Subtotal" }), el("span", { textContent: money(r.subtotal) })),
    el("div", { className: "r-line" }, el("span", { textContent: "Tax" }), el("span", { textContent: money(r.tax) })),
    el("div", { className: "r-line r-total" }, el("span", { textContent: "Total" }), el("span", { textContent: money(r.total) })),
    el("hr"),
    el("div", { className: "r-line" }, el("span", { textContent: "Sealed by" }), el("span", { textContent: seal.staff_id || "-" })),
    el("div", { className: "r-line" }, el("span", { textContent: "Camera match" }),
      el("span", { textContent: overrides.length ? `${overrides.length} staff override${overrides.length > 1 ? "s" : ""}` : "all items ✓" })),
    ...overrides.map(([k, v]) => el("div", { className: "r-mod", textContent: `${k}: ${v}` })),
    seal.frame_sha256 ? el("div", { className: "r-muted dr-hash", textContent: `Evidence frame sha256 ${seal.frame_sha256.slice(0, 16)}…` }) : null,
    el("hr"),
    el("div", { className: "r-line" }, el("span", { textContent: "Deliver to" }), el("span", { className: "dr-addr", textContent: o.delivery_address || o.delivery_city })),
    el("div", { className: "r-line" }, el("span", { textContent: "Dasher" }), el("span", { textContent: o.dasher_name })),
  );
}

function renderNextOrders(currentId) {
  const waiting = state.orders.filter((o) => o.id !== currentId && (o.status === "new" || o.status === "prepared"));
  const ul = $("#next-orders");
  if (!waiting.length) {
    ul.replaceChildren(el("li", { className: "caught-up", textContent: "All caught up 🎉 No orders waiting." }));
    $("#qr-close").textContent = "Done";
    return;
  }
  $("#qr-close").textContent = `Start #${waiting[0].id} →`;
  ul.replaceChildren(...waiting.map((o) => {
    const icons = el("div", { className: "mini-icons" },
      ...o.labels.slice(0, 5).map((l) => el("span", { className: "mini-icon" }, KAWAII(l) || "🍽️")));
    const li = el("li", { className: "next-card" },
      icons,
      el("div", { className: "next-info" },
        el("strong", { textContent: `#${o.id} ${o.display_name}` }),
        el("div", { className: "small muted", textContent: `${o.item_count} item${o.item_count === 1 ? "" : "s"} · ${o.delivery_city} · ${o.dasher_name}` })),
      el("span", { className: `pill ${o.status === "prepared" ? "warn" : ""}`, textContent: o.status === "prepared" ? "in progress" : "new" }));
    li.addEventListener("click", () => { closeDone(); openOrder(o.id); });
    return li;
  }));
}

async function pickupAs(token, pickupToken) {
  return api("/api/pickup", { method: "POST", token, json: { token: pickupToken } });
}

$("#sim-scan").addEventListener("click", async () => {
  const out = $("#sim-result");
  try {
    // The Dasher authenticates with their own credentials; the staff session isn't used.
    const s = await api("/api/auth/login", { method: "POST", json: { user_id: $("#sim-dasher").value, pin: $("#sim-pin").value } });
    if (s.role !== "dasher") throw new Error("Not a Dasher account");
    const r = await pickupAs(s.token, state.lastToken);
    out.textContent = `✓ ${s.user_id} picked up #${r.order_id} (${r.item_count} items)`;
    out.className = "sim-result ok";
    if (state.current && state.current.id === r.order_id) {
      state.current = await authed(`/api/orders/${r.order_id}`);
      renderSide();
      renderNextSteps(state.current); // marks "Hand it off" done
    }
  } catch (e) {
    out.textContent = `✗ ${e.message}`;
    out.className = "sim-result bad";
  }
  refreshQueue();
  refreshLog();
});

$("#copy-code").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(state.lastToken || ""); $("#copy-code").textContent = "Copied ✓"; }
  catch { $("#copy-code").textContent = "Copy failed"; }
  setTimeout(() => ($("#copy-code").textContent = "Copy pickup code"), 1500);
});

$("#qr-close").addEventListener("click", () => {
  closeDone();
  const currentId = state.current && state.current.id;
  const next = state.orders.find((o) => o.id !== currentId && (o.status === "new" || o.status === "prepared"));
  if (next) openOrder(next.id);
});

// ---------------- camera ----------------

const grab = document.createElement("canvas");

async function startCamera(deviceId) {
  stopCamera();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
                      : { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (e) {
    $("#stage-msg").textContent = `Camera unavailable (${e.name}). Use “Upload photo”.`;
    return;
  }
  $("#video").srcObject = state.stream;
  state.camOn = true;
  $("#cam-toggle").textContent = "Pause";
  listCameras();
  updateStageMsg();
  liveLoop();
}

function stopCamera() {
  state.camOn = false;
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
  $("#video").srcObject = null;
  $("#cam-toggle").textContent = "Resume";
}

async function listCameras() {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  const current = state.stream && state.stream.getVideoTracks()[0].getSettings().deviceId;
  $("#camera-select").replaceChildren(...devices.map((d, i) =>
    el("option", { value: d.deviceId, textContent: d.label || `Camera ${i + 1}`, selected: d.deviceId === current })));
}
$("#camera-select").addEventListener("change", (e) => { backToLive(false); startCamera(e.target.value); });

$("#cam-toggle").addEventListener("click", () => {
  if (state.photoMode) return backToLive();
  if (state.camOn) { stopCamera(); updateStageMsg("Camera paused"); }
  else startCamera($("#camera-select").value || undefined);
});

function backToLive(restart = true) {
  state.photoMode = false;
  $("#photo").classList.add("hidden");
  $("#video").classList.remove("hidden");
  clearOverlay();
  if (restart && !state.camOn) startCamera($("#camera-select").value || undefined);
  $("#cam-toggle").textContent = state.camOn ? "Pause" : "Resume";
}

function updateStageMsg(override) {
  const o = state.current;
  let msg = "";
  if (override) msg = override;
  else if (!o) msg = "Pick an order on the left, then lay its items flat in view";
  else if (o.status === "new") msg = "Building checklist…";
  else if (o.status === "sealed" || o.status === "picked_up") msg = `Order #${o.id} is ${o.status.replace("_", " ")}. Pick the next order`;
  $("#stage-msg").textContent = msg;
}

function readyToCheck() {
  return state.current && state.current.status === "prepared";
}

async function liveLoop() {
  if (!state.camOn) return;
  // The interval is measured from when this frame was sent, not after the answer
  // comes back: the old fixed wait after each response added 1.5 s per update.
  const started = Date.now();
  const interval = state.frameInterval || 400;
  let delay = 0;
  const v = $("#video");
  if (!state.photoMode && readyToCheck() && v.videoWidth && !document.hidden) {
    // 800 px is plenty; the server downsizes to 640 for OpenRouter anyway.
    const scale = Math.min(1, 800 / v.videoWidth);
    grab.width = Math.round(v.videoWidth * scale);
    grab.height = Math.round(v.videoHeight * scale);
    grab.getContext("2d").drawImage(v, 0, 0, grab.width, grab.height);
    const blob = await new Promise((r) => grab.toBlob(r, "image/jpeg", 0.8));
    try {
      await sendFrame(blob, "live");
      delay = Math.max(50, interval - (Date.now() - started));
    } catch (e) {
      if (e.code === "busy") { delay = 200; }
      else if (e.code === "loading") { $("#cam-msg").textContent = e.message; delay = 2000; pollHealth(); }
      else if (e.status === 409) { /* order sealed meanwhile */ }
      else { $("#cam-msg").textContent = e.message; delay = 3000; }
    }
  } else {
    delay = 400; // nothing to check yet
  }
  setTimeout(liveLoop, delay);
}

$("#upload").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!readyToCheck()) { $("#cam-msg").textContent = "Pick an order first"; return; }
  state.photoMode = true;
  const img = $("#photo");
  img.src = URL.createObjectURL(file);
  await img.decode().catch(() => {});
  $("#video").classList.add("hidden");
  img.classList.remove("hidden");
  $("#cam-toggle").textContent = "Back to live";
  try {
    await sendFrame(file, "photo");
  } catch (err) {
    $("#cam-msg").textContent = err.message;
  }
});

async function sendFrame(blob, mode) {
  const id = state.current.id;
  const form = new FormData();
  form.append("frame", blob, "frame.jpg");
  form.append("mode", mode);
  const r = await authed(`/api/orders/${id}/frame`, { method: "POST", form });
  if (!state.current || state.current.id !== id) return; // switched orders mid-request
  state.lastResult = r;
  const found = Object.values(r.counts || {}).reduce((a, b) => a + b, 0) || r.boxes.length;
  $("#cam-msg").textContent = `${found} objects · ${r.model || "vision"}${r.fallback_reason ? ` (OpenRouter failed: ${r.fallback_reason})` : ""} · frame ${r.frame_sha256.slice(0, 10)}…`;
  announceDetections(id, r);
  renderChecklist(r.items);
  if ($("#stage-msg").textContent) updateStageMsg();
  refreshLog();
}

function clearOverlay() {
  state.lastResult = null;
  flashes.length = 0;
  const c = $("#overlay");
  c.getContext("2d").clearRect(0, 0, c.width, c.height);
  clearToasts();
  $("#banner").classList.add("hidden");
  $("#cam-msg").textContent = "";
}

// When an item's count goes up: a "Bottle detected!" toast plus a box around it
// that shows for 2 s and fades. Counts are sticky, so each unit announces once.
const seenCounts = {}; // orderId -> {label: last detected}

function announceDetections(orderId, r) {
  const seen = (seenCounts[orderId] = seenCounts[orderId] || {});
  const fresh = new Set();
  for (const i of r.items) {
    if (i.expected > 0 && i.detected > (seen[i.label] || 0)) {
      showToast(i);
      fresh.add(i.label);
    }
    seen[i.label] = i.detected;
  }
  if (fresh.size) flashBoxes(r, fresh);
}

const FLASH_MS = 2000;
const flashes = []; // {b, w, h, until}
let flashRaf = null;

function flashBoxes(r, labels) {
  const until = performance.now() + FLASH_MS;
  for (const b of r.boxes || []) {
    if (labels.has(b.label)) flashes.push({ b, w: r.width, h: r.height, until });
  }
  if (!flashRaf) flashRaf = requestAnimationFrame(drawFlashes);
}

function drawFlashes() {
  flashRaf = null;
  const c = $("#overlay");
  const dpr = window.devicePixelRatio || 1;
  const cw = c.clientWidth, ch = c.clientHeight;
  if (c.width !== cw * dpr || c.height !== ch * dpr) { c.width = cw * dpr; c.height = ch * dpr; }
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const now = performance.now();
  for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].until <= now) flashes.splice(i, 1);
  if (!flashes.length) return;

  // Live video uses object-fit: cover, uploaded photos use contain.
  const media = state.photoMode ? $("#photo") : $("#video");
  ctx.lineWidth = 4;
  ctx.font = "800 15px system-ui, sans-serif";
  for (const f of flashes) {
    const nw = media.videoWidth || media.naturalWidth || f.w;
    const nh = media.videoHeight || media.naturalHeight || f.h;
    const s = state.photoMode ? Math.min(cw / nw, ch / nh) : Math.max(cw / nw, ch / nh);
    const ox = (cw - nw * s) / 2, oy = (ch - nh * s) / 2;
    const k = (nw / f.w) * s;
    const [x1, y1, x2, y2] = f.b.box.map((v, i) => (i % 2 ? oy : ox) + v * k);
    const left = f.until - now;
    ctx.globalAlpha = Math.min(1, left / 400); // fade out over the last 0.4 s
    ctx.strokeStyle = "#b4473a";
    ctx.beginPath();
    ctx.roundRect(x1, y1, x2 - x1, y2 - y1, 14);
    ctx.stroke();
    const text = f.b.label;
    const tw = ctx.measureText(text).width + 18;
    const ty = Math.max(0, y1 - 28);
    ctx.fillStyle = "#b4473a";
    ctx.beginPath();
    ctx.roundRect(x1, ty, tw, 24, 12);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(text, x1 + 9, ty + 17);
  }
  ctx.globalAlpha = 1;
  flashRaf = requestAnimationFrame(drawFlashes);
}

// "Bottle detected!" stays on screen: pops in big, then shrinks into a compact tag in a
// stack. One tag per item (updated if its count rises). Cleared by clearOverlay().
function showToast(item) {
  const box = $("#toasts");
  const name = item.label.charAt(0).toUpperCase() + item.label.slice(1);
  const extra = item.expected > 1 ? ` (${Math.min(item.detected, item.expected)}/${item.expected})` : "";
  let toast = [...box.children].find((t) => t.dataset.label === item.label);
  if (toast) {
    toast.querySelector(".t-text").textContent = `${name} detected!${extra}`;
    toast.classList.remove("compact");
    toast.style.animation = "none";
    void toast.offsetWidth; // restart the pop animation
    toast.style.animation = "";
  } else {
    toast = el("div", { className: "toast", dataset: { label: item.label } },
      el("span", { className: "t-icon" }, KAWAII(item.label) || (FOOD_ICONS[item.label] || "🍽️")),
      el("span", { className: "t-text", textContent: `${name} detected!${extra}` }));
    box.append(toast);
  }
  clearTimeout(toast._shrink);
  toast._shrink = setTimeout(() => toast.classList.add("compact"), 2000);
}

function clearToasts() {
  $("#toasts").replaceChildren();
}

// ---------------- audit log ----------------

$("#open-log").addEventListener("click", () => { $("#log-drawer").classList.remove("hidden"); refreshLog(true); });
$("#close-log").addEventListener("click", () => $("#log-drawer").classList.add("hidden"));

let logTimer = null;
function refreshLog(now = false) {
  if ($("#log-drawer").classList.contains("hidden") && !now) return;
  clearTimeout(logTimer);
  logTimer = setTimeout(async () => {
    const r = await authed("/api/log").catch(() => null);
    if (!r) return;
    const chain = $("#chain");
    chain.textContent = r.valid ? `Hash chain intact · ${r.count} events` : `CHAIN BROKEN at #${r.broken_at}`;
    chain.className = `pill ${r.valid ? "ok" : "bad"}`;
    $("#log").replaceChildren(...r.events.slice().reverse().map((ev) => {
      const t = new Date(ev.ts * 1000).toLocaleTimeString();
      return el("li", {},
        el("span", { textContent: `#${ev.seq} ${t} ${ev.type} by ${ev.actor} ${JSON.stringify(ev.data)} ` }),
        el("span", { className: "hash", textContent: `hash ${ev.hash.slice(0, 10)}… prev ${ev.prev.slice(0, 10)}…` }));
    }));
  }, now ? 0 : 300);
}

// ---------------- Dasher view ----------------

function enterDasher() {
  show("#view-dasher");
  $("#dasher-name").textContent = state.session.user_id;
  $("#scan-result").textContent = "";
  $("#scan-result").className = "sim-result";
}

$("#paste-token").addEventListener("click", async () => {
  try { $("#scan-token").value = await navigator.clipboard.readText(); } catch { /* permission denied */ }
});

$("#scan").addEventListener("click", async () => {
  const out = $("#scan-result");
  try {
    const r = await authed("/api/pickup", { method: "POST", json: { token: $("#scan-token").value.trim() } });
    out.textContent = `✓ Picked up order #${r.order_id} (${r.ref}) for ${r.display_name}, ${r.item_count} items`;
    out.className = "sim-result ok";
  } catch (e) {
    out.textContent = `✗ ${e.message}`;
    out.className = "sim-result bad";
  }
});

// ---------------- boot ----------------

(function restore() {
  // The completion page needs the one-time QR from the seal response, which isn't
  // kept anywhere, so a refresh lands back on the station.
  if (location.hash) history.replaceState(null, "", location.pathname);
  let s = null;
  try { s = JSON.parse(sessionStorage.getItem("dcl-session") || "null"); } catch {}
  setLoginRole("staff");
  if (s && s.token) startSession(s);
  else showLogin();
  runPreview();
})();
