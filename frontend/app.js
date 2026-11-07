// DashCheckLive frontend. Plain JS, no build step.
// Session tokens are kept in memory only (not localStorage), and all
// server/customer text is rendered with textContent, never innerHTML.

const $ = (sel) => document.querySelector(sel);

const state = {
  staffToken: null,
  dasherToken: null,
  orders: [],
  current: null,      // full order object from /api/orders/:id
  overrides: {},      // label -> reason typed by staff
  checklistKey: "",
  live: false,
  stream: null,
  lastToken: null,
};

// ---------- helpers ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
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
    const err = new Error(typeof data.detail === "string" ? data.detail : `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function staffApi(path, opts = {}) {
  return api(path, { ...opts, token: state.staffToken }).catch((e) => {
    if (e.status === 401) staffLogout();
    throw e;
  });
}

const pillClass = { new: "", prepared: "warn", sealed: "ok", picked_up: "ok" };

// ---------- health ----------

async function loadHealth() {
  const h = await api("/api/health");
  const box = $("#health");
  box.replaceChildren(
    el("span", { className: `pill ${h.detector.startsWith("ready") || h.detector.startsWith("available") ? "ok" : "warn"}`, textContent: `Vision (local): ${h.detector}` }),
    el("span", { className: `pill ${h.parser.startsWith("openrouter") ? "ok" : "warn"}`, textContent: `Parser: ${h.parser}` }),
    el("span", { className: "pill ok", textContent: "Images stay on device" }),
  );
}

// ---------- staff auth ----------

$("#staff-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const s = await api("/api/auth/login", { method: "POST", json: { user_id: f.get("user_id"), pin: f.get("pin") } });
    if (s.role !== "merchant_staff") throw new Error("This account is not restaurant staff");
    state.staffToken = s.token;
    $("#staff-name").textContent = s.user_id;
    $("#staff-login").classList.add("hidden");
    $("#staff-app").classList.remove("hidden");
    $("#staff-login-error").textContent = "";
    e.target.reset();
    await refreshQueue();
    await refreshLog();
  } catch (err) {
    $("#staff-login-error").textContent = err.message;
  }
});

function staffLogout() {
  stopCamera();
  state.staffToken = null;
  state.current = null;
  $("#staff-app").classList.add("hidden");
  $("#staff-login").classList.remove("hidden");
}
$("#staff-logout").addEventListener("click", staffLogout);

$("#demo-reset").addEventListener("click", async () => {
  await staffApi("/api/demo/reset", { method: "POST" });
  stopCamera();
  state.current = null;
  $("#order-view").classList.add("hidden");
  $("#order-empty").classList.remove("hidden");
  $("#qr-box").classList.add("hidden");
  await refreshQueue();
  await refreshLog();
});

// ---------- queue + order ----------

async function refreshQueue() {
  state.orders = await staffApi("/api/orders");
  const ul = $("#queue");
  ul.replaceChildren(...state.orders.map((o) => {
    const li = el("li", {},
      el("div", { textContent: `#${o.id} · ${o.display_name}` }),
      el("div", { className: "meta", textContent: `${o.item_count} items · ${o.status}` }));
    if (state.current && state.current.id === o.id) li.classList.add("active");
    li.addEventListener("click", () => openOrder(o.id));
    return li;
  }));
}

async function openOrder(id) {
  stopCamera();
  state.overrides = {};
  state.checklistKey = "";
  state.current = await staffApi(`/api/orders/${encodeURIComponent(id)}`);
  $("#qr-box").classList.add("hidden");
  $("#confirm").checked = false;
  $("#prep-ack").checked = false;
  clearStage();
  renderOrder();
  refreshQueue();
}

function renderOrder() {
  const o = state.current;
  $("#order-empty").classList.add("hidden");
  $("#order-view").classList.remove("hidden");
  $("#order-title").textContent = `Order #${o.id} — ${o.display_name}`;
  const status = $("#order-status");
  status.textContent = o.status;
  status.className = `pill ${pillClass[o.status] || ""}`;
  $("#order-items").replaceChildren(...o.items.map((i) => el("li", { textContent: `${i.qty} × ${i.name}` })));

  const parsed = o.parsed || {};
  const allergy = $("#allergy");
  if (parsed.allergy_flags && parsed.allergy_flags.length) {
    allergy.textContent = `⚠ ALLERGY: ${parsed.allergy_flags.join(", ").toUpperCase()}`;
    allergy.classList.remove("hidden");
  } else allergy.classList.add("hidden");

  const isNew = o.status === "new";
  $("#prepare-box").classList.toggle("hidden", !isNew);
  $("#checked-box").classList.toggle("hidden", isNew);

  if (!isNew) {
    $("#note-text").textContent = o.note || "(no note)";
    const red = Object.entries(o.redactions || {}).map(([k, n]) => `${n}× ${k}`).join(", ");
    $("#redactions").textContent = red ? `Redacted before AI: ${red}` : "No personal data found in note.";
    $("#parser-used").textContent = `Parsed by: ${parsed.parser || "-"}`;
    const prep = $("#prep");
    if (parsed.prep_instructions && parsed.prep_instructions.length) {
      prep.replaceChildren(el("div", { className: "label", textContent: "Prep (camera can't verify — check by hand)" }),
        ...parsed.prep_instructions.map((p) => el("div", { textContent: `• ${p}` })));
      prep.classList.remove("hidden");
    } else prep.classList.add("hidden");
  }

  const prepNeeded = (parsed.prep_instructions || []).length || (parsed.allergy_flags || []).length;
  $("#prep-ack").closest("label").classList.toggle("hidden", !prepNeeded);
  $("#seal-box").classList.toggle("hidden", o.status !== "prepared");
  if (o.status === "sealed" || o.status === "picked_up") {
    $("#checklist").replaceChildren(el("p", { textContent: o.status === "sealed" ? "Sealed. Waiting for Dasher pickup." : "Picked up by Dasher." }));
  } else {
    renderChecklist(o.checklist || [], true);
  }
}

$("#prepare").addEventListener("click", async () => {
  const btn = $("#prepare");
  btn.disabled = true;
  btn.textContent = "Scrubbing & parsing…";
  try {
    state.current = await staffApi(`/api/orders/${state.current.id}/prepare`, { method: "POST" });
    renderOrder();
    refreshQueue();
    refreshLog();
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Build packing checklist";
  }
});

// ---------- checklist + seal ----------

const statusText = { ok: "✓", missing: "MISSING", check: "CHECK MANUALLY", unexpected: "REMOVE?" };

function renderChecklist(items, force = false) {
  if (!state.current || state.current.status !== "prepared") return;
  state.current.checklist = items;
  const key = JSON.stringify(items.map((i) => [i.label, i.detected, i.status]));
  if (!force && key === state.checklistKey) return updateSealButton();
  state.checklistKey = key;

  if (!items.length) {
    $("#checklist").textContent = "Nothing to check.";
    return updateSealButton();
  }
  const ul = el("ul");
  for (const i of items) {
    const want = i.expected === 0 ? "leave out" : `${i.detected}/${i.expected}`;
    const row = el("li", { className: `row ${i.status}` },
      el("div", { className: "top" },
        el("span", {}, el("strong", { textContent: i.label }), el("span", { className: "muted small", textContent: i.source === "note" ? "  (from note)" : "" })),
        el("span", { className: `status-${i.status}`, textContent: `${want} ${statusText[i.status]}` })));
    if (i.status !== "ok") {
      const input = el("input", { placeholder: "Override reason (e.g. added by hand, verified visually)", value: state.overrides[i.label] || "", maxLength: 120 });
      input.addEventListener("input", () => { state.overrides[i.label] = input.value; updateSealButton(); });
      row.append(input);
    }
    ul.append(row);
  }
  $("#checklist").replaceChildren(ul);
  updateSealButton();
}

function updateSealButton() {
  const o = state.current;
  if (!o || o.status !== "prepared") return;
  const parsed = o.parsed || {};
  const prepNeeded = (parsed.prep_instructions || []).length || (parsed.allergy_flags || []).length;
  const rowsOk = (o.checklist || []).every((i) => i.status === "ok" || (state.overrides[i.label] || "").trim().length >= 3);
  $("#seal").disabled = !($("#confirm").checked && (!prepNeeded || $("#prep-ack").checked) && rowsOk);
}
$("#confirm").addEventListener("change", updateSealButton);
$("#prep-ack").addEventListener("change", updateSealButton);

$("#seal").addEventListener("click", async () => {
  $("#seal-error").textContent = "";
  const overrides = {};
  for (const i of state.current.checklist || []) {
    if (i.status !== "ok") overrides[i.label] = state.overrides[i.label] || "";
  }
  try {
    const r = await staffApi(`/api/orders/${state.current.id}/seal`, {
      method: "POST",
      json: { confirmed: $("#confirm").checked, prep_acknowledged: $("#prep-ack").checked, overrides },
    });
    stopCamera();
    state.current = r.order;
    state.lastToken = r.pickup_token;
    $("#qr").src = r.qr_png;
    $("#qr-dasher").textContent = r.order.dasher_id;
    $("#qr-ttl").textContent = `${Math.round(r.expires_in / 60)} min`;
    $("#qr-box").classList.remove("hidden");
    renderOrder();
    refreshQueue();
    refreshLog();
  } catch (e) {
    $("#seal-error").textContent = e.message;
  }
});

$("#send-to-phone").addEventListener("click", () => {
  $("#scan-token").value = state.lastToken || "";
});

// ---------- camera + detection ----------

const grab = document.createElement("canvas");

function clearStage() {
  const c = $("#overlay");
  c.getContext("2d").clearRect(0, 0, c.width, c.height);
  $("#photo").classList.add("hidden");
  $("#video").classList.remove("hidden");
  $("#stage-empty").classList.remove("hidden");
  $("#cam-msg").textContent = "";
}

async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    $("#cam-msg").textContent = `Camera unavailable (${e.name}). Use photo upload.`;
    return;
  }
  clearStage();
  $("#stage-empty").classList.add("hidden");
  $("#video").srcObject = state.stream;
  state.live = true;
  $("#cam-toggle").textContent = "Stop camera";
  liveLoop();
}

function stopCamera() {
  state.live = false;
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
  $("#video").srcObject = null;
  $("#cam-toggle").textContent = "Start camera";
}

$("#cam-toggle").addEventListener("click", () => (state.live ? stopCamera() : startCamera()));

async function liveLoop() {
  if (!state.live) return;
  const v = $("#video");
  if (v.videoWidth) {
    const scale = Math.min(1, 640 / v.videoWidth);
    grab.width = Math.round(v.videoWidth * scale);
    grab.height = Math.round(v.videoHeight * scale);
    grab.getContext("2d").drawImage(v, 0, 0, grab.width, grab.height);
    const blob = await new Promise((r) => grab.toBlob(r, "image/jpeg", 0.75));
    try {
      const r = await sendFrame(blob, "live");
      drawBoxes(r, v);
    } catch (e) {
      $("#cam-msg").textContent = e.message;
      if (e.status === 503 || e.status === 409) return stopCamera();
    }
  }
  setTimeout(liveLoop, 500);
}

$("#upload").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  stopCamera();
  const img = $("#photo");
  img.src = URL.createObjectURL(file);
  await img.decode().catch(() => {});
  $("#video").classList.add("hidden");
  img.classList.remove("hidden");
  $("#stage-empty").classList.add("hidden");
  try {
    const r = await sendFrame(file, "photo");
    drawBoxes(r, img);
  } catch (err) {
    $("#cam-msg").textContent = err.message;
  }
});

async function sendFrame(blob, mode) {
  const form = new FormData();
  form.append("frame", blob, "frame.jpg");
  form.append("mode", mode);
  const r = await staffApi(`/api/orders/${state.current.id}/frame`, { method: "POST", form });
  $("#cam-msg").textContent = `frame sha256 ${r.frame_sha256.slice(0, 12)}… · ${r.boxes.length} boxes`;
  renderChecklist(r.items);
  refreshLog();
  return r;
}

function drawBoxes(result, media) {
  const c = $("#overlay");
  c.width = media.clientWidth;
  c.height = media.clientHeight;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  const sx = c.width / result.width;
  const sy = c.height / result.height;
  ctx.lineWidth = 3;
  ctx.font = "bold 14px system-ui";
  for (const b of result.boxes) {
    const [x1, y1, x2, y2] = b.box;
    const strong = b.conf >= 0.35;
    ctx.strokeStyle = ctx.fillStyle = strong ? "#2ecc71" : "#f39c12";
    ctx.strokeRect(x1 * sx, y1 * sy, (x2 - x1) * sx, (y2 - y1) * sy);
    const text = `${b.label} ${Math.round(b.conf * 100)}%`;
    const w = ctx.measureText(text).width + 8;
    ctx.fillRect(x1 * sx, Math.max(0, y1 * sy - 20), w, 20);
    ctx.fillStyle = "#000";
    ctx.fillText(text, x1 * sx + 4, Math.max(14, y1 * sy - 5));
  }
}

// ---------- audit log ----------

let logTimer = null;
function refreshLog() {
  clearTimeout(logTimer);
  logTimer = setTimeout(async () => {
    if (!state.staffToken) return;
    const r = await staffApi("/api/log").catch(() => null);
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
  }, 250);
}

// ---------- Dasher phone ----------

$("#dasher-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const s = await api("/api/auth/login", { method: "POST", json: { user_id: f.get("user_id"), pin: f.get("pin") } });
    if (s.role !== "dasher") throw new Error("Not a Dasher account");
    state.dasherToken = s.token;
    $("#dasher-name").textContent = s.user_id;
    $("#dasher-login").classList.add("hidden");
    $("#dasher-app").classList.remove("hidden");
    $("#dasher-login-error").textContent = "";
    $("#scan-result").textContent = "";
    $("#scan-result").className = "scan-result";
    e.target.reset();
  } catch (err) {
    $("#dasher-login-error").textContent = err.message;
  }
  refreshLog();
});

$("#dasher-logout").addEventListener("click", () => {
  state.dasherToken = null;
  $("#dasher-app").classList.add("hidden");
  $("#dasher-login").classList.remove("hidden");
});

$("#scan").addEventListener("click", async () => {
  const out = $("#scan-result");
  try {
    const r = await api("/api/pickup", { method: "POST", token: state.dasherToken, json: { token: $("#scan-token").value.trim() } });
    out.textContent = `✓ Picked up order #${r.order_id} for ${r.display_name} (${r.item_count} items)`;
    out.className = "scan-result ok";
    if (state.current && state.current.id === r.order_id) {
      state.current.status = "picked_up";
      $("#qr-box").classList.add("hidden");
      renderOrder();
    }
  } catch (e) {
    out.textContent = `✗ ${e.message}`;
    out.className = "scan-result bad";
  }
  refreshLog();
  if (state.staffToken) refreshQueue();
});

loadHealth().catch(() => {});
