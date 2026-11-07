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
  Object.assign(node, props);
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
  for (const v of ["#view-login", "#view-station", "#view-dasher"]) $(v).classList.toggle("hidden", v !== view);
}

function money(n) { return `$${n.toFixed(2)}`; }

// ---------------- sign in / out ----------------

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $("#login-error").textContent = "";
  try {
    const s = await api("/api/auth/login", { method: "POST", json: { user_id: f.get("user_id").trim(), pin: f.get("pin") } });
    e.target.reset();
    startSession(s);
  } catch (err) {
    $("#login-error").textContent = err.message;
  }
});

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
  $("#qr-modal").classList.add("hidden");
  $("#log-drawer").classList.add("hidden");
  $("#login-error").textContent = message;
  show("#view-login");
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
  const d = h.detector;
  let text, cls;
  if (d.state === "ready") { text = `Vision: ${d.backends.join(" + ")}`; cls = "ok"; }
  else if (d.state === "loading") { text = "Vision: loading models…"; cls = "warn"; }
  else { text = `Vision: ${d.state}`; cls = "bad"; }
  $("#health").replaceChildren(
    el("span", { className: `pill ${cls}`, textContent: text, title: JSON.stringify(d.errors || {}) }),
    el("span", { className: `pill ${h.parser.startsWith("openrouter") ? "ok" : "warn"}`, textContent: `Notes: ${h.parser}` }),
    el("span", { className: "pill ok", textContent: "Images stay on device" }),
  );
  if (d.state === "loading" || d.state === "idle") state.healthTimer = setTimeout(pollHealth, 3000);
}

async function refreshQueue() {
  const r = await authed("/api/orders");
  state.orders = r.orders;
  $("#store-name").textContent = r.store;
  $("#queue-count").textContent = r.orders.filter((o) => o.status !== "picked_up").length;
  $("#queue").replaceChildren(...r.orders.map((o) => {
    const statusCls = { new: "", prepared: "warn", sealed: "ok", picked_up: "ok" }[o.status] || "";
    const li = el("li", {},
      el("div", {},
        el("div", {}, el("strong", { textContent: `#${o.id}` }), ` ${o.display_name}`),
        el("div", { className: "meta", textContent: `${o.item_count} items · ${o.ref} · ${o.dasher_name}` })),
      el("span", { className: `pill st ${statusCls}`, textContent: o.status.replace("_", " ") }));
    if (state.current && state.current.id === o.id) li.classList.add("active");
    li.addEventListener("click", () => openOrder(o.id));
    return li;
  }));
}

$("#demo-reset").addEventListener("click", async () => {
  await authed("/api/demo/reset", { method: "POST" });
  state.current = null;
  state.overrides = {};
  clearOverlay();
  $("#receipt").classList.add("hidden");
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

function renderReceipt() {
  const o = state.current;
  const r = o.receipt;
  const box = $("#receipt");
  const lines = [];
  for (const l of r.lines) {
    lines.push(el("div", { className: "r-line" }, el("span", { textContent: `${l.qty}× ${l.name}` }), el("span", { textContent: money(l.total) })));
    for (const m of l.modifiers) lines.push(el("div", { className: "r-mod", textContent: `• ${m}` }));
  }
  const placed = new Date(o.placed_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const red = Object.entries(o.redactions || {}).map(([k, n]) => `${n}× ${k}`).join(", ");
  box.replaceChildren(
    el("div", { className: "r-demo", textContent: "SAMPLE RECEIPT · DEMO DATA" }),
    el("div", { className: "r-center", textContent: "DoorDash order" }),
    el("div", { className: "r-center r-big", textContent: `#${o.id} · ${o.display_name}` }),
    el("div", { className: "r-center r-muted", textContent: `${o.store}` }),
    el("div", { className: "r-center r-muted", textContent: `${o.ref} · ${o.fulfillment} · ${placed}` }),
    el("hr"),
    ...lines,
    el("hr"),
    el("div", { className: "r-line" }, el("span", { textContent: "Subtotal" }), el("span", { textContent: money(r.subtotal) })),
    el("div", { className: "r-line" }, el("span", { textContent: "Tax" }), el("span", { textContent: money(r.tax) })),
    el("div", { className: "r-line r-total" }, el("span", { textContent: "Total" }), el("span", { textContent: money(r.total) })),
    el("hr"),
    el("div", { className: "r-muted", textContent: "Customer note" }),
    el("div", { className: "r-note", textContent: o.status === "new" ? "(hidden until personal info is removed)" : (o.note || "(none)") }),
    red ? el("div", { className: "r-muted", textContent: `Removed: ${red}` }) : null,
    el("hr"),
    el("div", { className: "r-line" }, el("span", { textContent: "Dasher" }), el("span", { textContent: o.dasher_name })),
    el("div", { className: "r-muted", textContent: "Customer contact hidden from merchant" }),
  );
  box.classList.remove("hidden");
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
  $("#confirm").checked = false;
  $("#seal-error").textContent = "";

  const done = $("#done-box");
  done.classList.add("hidden");
  if (!o) {
    $("#checklist").replaceChildren(el("p", { className: "muted", textContent: "Pick an order on the left." }));
    setBanner(null);
    updateStageMsg();
    return;
  }
  if (o.status === "sealed" || o.status === "picked_up") {
    $("#checklist").replaceChildren();
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
  const ul = el("ul");
  for (const i of items) {
    const count = i.expected === 0 ? (i.detected ? "in view" : "left out ✓") : `${i.detected}/${i.expected}${i.status === "ok" ? " ✓" : ""}`;
    const row = el("li", { className: `row ${i.status}` },
      el("div", { className: "top" },
        el("span", {}, el("span", { className: "name", textContent: i.label }),
          el("span", { className: "src", textContent: i.source === "menu" ? "" : `from ${i.source}` })),
        el("span", { className: "count-big", textContent: count })),
      whyText[i.status] ? el("div", { className: "why", textContent: whyText[i.status](i) })
        : i.low_conf ? el("div", { className: "why", textContent: "Counted (low confidence). Quick glance" }) : null);
    if (i.status !== "ok") {
      const input = el("input", { placeholder: "Optional reason, e.g. verified by hand", value: ov[i.label] || "", maxLength: 120 });
      input.addEventListener("input", () => { ov[i.label] = input.value; updateSealButton(); });
      row.append(input);
    }
    ul.append(row);
  }
  $("#checklist").replaceChildren(ul);
  updateSealButton();
}

function setBanner(items) {
  const b = $("#banner");
  if (!items || !items.length || !state.lastResult) { b.classList.add("hidden"); return; }
  const bad = items.filter((i) => i.status === "missing" || i.status === "unexpected");
  const check = items.filter((i) => i.status === "check");
  if (!bad.length && !check.length) {
    b.textContent = "✓ All items present. Confirm & seal";
    b.className = "banner ok";
  } else if (bad.length) {
    b.textContent = bad.map((i) => i.status === "unexpected" ? `Remove ${i.label}` : `Missing ${i.label} ×${i.expected - i.detected}`).join(" · ");
    b.className = "banner bad";
  } else {
    b.textContent = `Check: ${check.map((i) => i.label).join(", ")}`;
    b.className = "banner warn";
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
    openQrModal(r);
    refreshQueue();
    refreshLog();
  } catch (e) {
    $("#seal-error").textContent = e.message;
  }
});

// ---------------- QR modal + simulated Dasher scan ----------------

function openQrModal(r) {
  $("#qr").src = r.qr_png;
  $("#qr-sub").textContent = `Order #${r.order.id} for ${r.order.display_name} · assigned to ${r.order.dasher_name} (${r.order.dasher_id})`;
  $("#qr-ttl").textContent = `${Math.round(r.expires_in / 60)} min`;
  $("#sim-dasher").value = r.order.dasher_id;
  $("#sim-pin").value = "";
  $("#sim-result").textContent = "";
  $("#sim-result").className = "sim-result";
  $("#qr-modal").classList.remove("hidden");
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
  $("#qr-modal").classList.add("hidden");
  const next = state.orders.find((o) => o.status === "new" || o.status === "prepared");
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
  let delay = 400;
  const v = $("#video");
  if (!state.photoMode && readyToCheck() && v.videoWidth && !document.hidden) {
    // 960 px wide keeps small items (sauce cups, forks) big enough to detect.
    const scale = Math.min(1, 960 / v.videoWidth);
    grab.width = Math.round(v.videoWidth * scale);
    grab.height = Math.round(v.videoHeight * scale);
    grab.getContext("2d").drawImage(v, 0, 0, grab.width, grab.height);
    const blob = await new Promise((r) => grab.toBlob(r, "image/jpeg", 0.85));
    try {
      await sendFrame(blob, "live");
    } catch (e) {
      if (e.code === "loading") { $("#cam-msg").textContent = e.message; delay = 2000; pollHealth(); }
      else if (e.status === 409) { /* order sealed meanwhile */ }
      else { $("#cam-msg").textContent = e.message; delay = 3000; }
    }
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
  $("#cam-msg").textContent = `${r.boxes.length} objects · frame ${r.frame_sha256.slice(0, 10)}…`;
  drawBoxes();
  renderChecklist(r.items);
  if ($("#stage-msg").textContent) updateStageMsg();
  refreshLog();
}

function clearOverlay() {
  state.lastResult = null;
  const c = $("#overlay");
  c.getContext("2d").clearRect(0, 0, c.width, c.height);
  $("#banner").classList.add("hidden");
  $("#cam-msg").textContent = "";
}

function drawBoxes() {
  const r = state.lastResult;
  const c = $("#overlay");
  const dpr = window.devicePixelRatio || 1;
  const cw = c.clientWidth, ch = c.clientHeight;
  c.width = cw * dpr;
  c.height = ch * dpr;
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!r) return;
  // Media is drawn with object-fit: contain; find where it actually sits.
  const media = state.photoMode ? $("#photo") : $("#video");
  const nw = media.videoWidth || media.naturalWidth || r.width;
  const nh = media.videoHeight || media.naturalHeight || r.height;
  const s = Math.min(cw / nw, ch / nh);
  const ox = (cw - nw * s) / 2, oy = (ch - nh * s) / 2;
  const k = (nw / r.width) * s;
  // Every box counts; low-confidence ones are drawn dashed orange so staff can glance at them.
  const confident = (r.thresholds && r.thresholds.confident) || 0.25;
  ctx.lineWidth = 3;
  ctx.font = "bold 15px system-ui";
  for (const b of r.boxes) {
    const [x1, y1, x2, y2] = b.box.map((v, i) => (i % 2 ? oy : ox) + v * k);
    const strong = b.conf >= confident;
    const color = strong ? "#2ecc71" : "#f5a623";
    ctx.strokeStyle = color;
    ctx.setLineDash(strong ? [] : [6, 4]);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    const text = `${b.label} ${Math.round(b.conf * 100)}%`;
    const w = ctx.measureText(text).width + 10;
    const ty = Math.max(0, y1 - 22);
    ctx.fillStyle = color;
    ctx.fillRect(x1, ty, w, 22);
    ctx.fillStyle = "#000";
    ctx.fillText(text, x1 + 5, ty + 16);
  }
  ctx.setLineDash([]);
}
window.addEventListener("resize", drawBoxes);

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
  let s = null;
  try { s = JSON.parse(sessionStorage.getItem("dcl-session") || "null"); } catch {}
  if (s && s.token) startSession(s);
  else show("#view-login");
})();
