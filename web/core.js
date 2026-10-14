"use strict";

// --- Go ---------------------------------------------------------------------

const go = (method, ...args) => window.mygo.call(method, ...args);
const errText = (e) => String(e?.message ?? e).replace(/^Error: /, "");
// A server key to check: the Go side's HostKeyError, as text.
const hostKeyOf = (e) => {
  const m = /hostkey:(\{.*\})/.exec(errText(e));
  try {
    return m ? JSON.parse(m[1]) : null;
  } catch {
    return null;
  }
};

// --- Icons ------------------------------------------------------------------

const svg = (d, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const icons = {
  server: svg('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>'),
  all: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  star: svg('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>'),
  starOn: svg('<path fill="currentColor" d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>', 'stroke-width="3"'),
  terminal: svg('<rect x="2.5" y="4" width="19" height="16" rx="3"/><path d="m7 9 3 3-3 3M13 15h4"/>'),
  chart: svg('<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>'),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
  tile: svg('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>'),
  broadcast: svg('<path d="M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4"/><circle cx="12" cy="12" r="2"/>'),
  key: svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14 9l2 2"/>'),
  import: svg('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
  upload: svg('<path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 3h14"/>'),
  cpu: svg('<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>'),
  memory: svg('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  gauge: svg('<path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/>'),
  disk: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18M7 17h.01"/>'),
  plug: svg('<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  more: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', 'stroke-width="2.6"'),
  play: svg('<path fill="currentColor" d="M7 4v16l13-8z"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>'),
  unlink: svg('<path d="M18.8 13.4 21 11.2a4.5 4.5 0 0 0-6.4-6.4l-2.2 2.2M5.2 10.6 3 12.8a4.5 4.5 0 0 0 6.4 6.4l2.2-2.2M8 2v3M2 8h3M16 22v-3M22 16h-3"/>'),
  tag: svg('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
  clockHist: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>'),
};

const colors = ["#7c5cf0", "#2f7de1", "#119a63", "#e08a00", "#d43c41", "#d63384", "#64748b"];

// --- State ------------------------------------------------------------------

const prefs = load("gossh.prefs", {
  layout: "cards",
  fontSize: 14,
  fontFamily: '"Cascadia Mono", Consolas, monospace',
  copyOnSelect: false,
  bell: false,
  listSort: "name",
  listDesc: false,
});
const state = {
  servers: [],
  groups: [],
  status: new Map(), // server ID → Status
  view: { type: "all" }, // all | fav | recent | group (name) | ungrouped
  selected: new Set(),
  tabs: [],
  active: null,
  tiled: false,
  broadcast: false,
  settings: null, // AppInfo
};

function load(key, fallback) {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") };
  } catch {
    return fallback;
  }
}
function savePrefs() {
  try {
    localStorage.setItem("gossh.prefs", JSON.stringify(prefs));
  } catch {}
}

function applyInventory(inv) {
  state.servers = inv.servers || [];
  state.groups = inv.groups || [];
  const ids = new Set(state.servers.map((s) => s.id));
  for (const id of state.selected) if (!ids.has(id)) state.selected.delete(id);
  for (const id of state.status.keys()) if (!ids.has(id)) state.status.delete(id);
  if (state.view.type === "group" && !state.groups.includes(state.view.name)) state.view = { type: "all" };
  renderAll();
}

async function reload() {
  applyInventory(await go("Servers.List"));
}

// --- Helpers ----------------------------------------------------------------

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const serverOf = (id) => state.servers.find((s) => s.id === id);
const statusOf = (id) => state.status.get(id);
const stateOf = (id) => {
  const v = serverOf(id);
  if (v && !v.monitor) return "off";
  return statusOf(id)?.state || "connecting";
};
const isUp = (id) => stateOf(id) === "online";
const isDown = (id) => ["offline", "hostkey"].includes(stateOf(id));
const addr = (v) => `${v.user ? v.user + "@" : ""}${v.host}${v.port && v.port !== 22 ? ":" + v.port : ""}`;
const stateLabels = { online: "En ligne", offline: "Hors ligne", hostkey: "Clé à vérifier", connecting: "Connexion…", off: "Non suivi" };

function sizeText(n, digits) {
  if (!n) return "0 o";
  const units = ["o", "Ko", "Mo", "Go", "To", "Po"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(digits ?? (n < 10 && i > 0 ? 1 : 0)).replace(".", ",")} ${units[i]}`;
}
function rateText(bytesPerSec) {
  const bits = bytesPerSec * 8;
  if (bits < 1000) return `${Math.round(bits)} b/s`;
  if (bits < 1e6) return `${(bits / 1e3).toFixed(bits < 1e4 ? 1 : 0)} Kb/s`;
  if (bits < 1e9) return `${(bits / 1e6).toFixed(bits < 1e7 ? 1 : 0)} Mb/s`;
  return `${(bits / 1e9).toFixed(1)} Gb/s`;
}
function ioText(bytesPerSec) {
  return sizeText(bytesPerSec, bytesPerSec < 10 * 1024 * 1024 && bytesPerSec >= 1024 ? 1 : 0) + "/s";
}
function durationText(sec) {
  sec = Math.floor(sec || 0);
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}j ${h}h`;
  if (h) return `${h}h ${m}min`;
  if (m) return `${m}min`;
  return `${sec}s`;
}
function agoText(t) {
  if (!t) return "jamais";
  const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  if (s < 5) return "à l'instant";
  if (s < 60) return `il y a ${Math.floor(s)} s`;
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}
const pct = (a, b) => (b ? (100 * a) / b : 0);
const pctText = (v) => `${Math.round(v)}%`;
const level = (v) => (v >= 90 ? "crit" : v >= 75 ? "warn" : "");
const bar = (v, cls = "") => `<div class="bar"><i class="${cls || level(v)}" style="width:${Math.min(100, Math.max(0, v)).toFixed(1)}%"></i></div>`;
// The busiest disk of a status.
function fullestDisk(st) {
  let best = null;
  for (const d of st?.disks || []) if (!best || d.used / d.total > best.used / best.total) best = d;
  return best;
}

function toast(text, error = false) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.textContent = text;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), error ? 6000 : 3200);
}

// --- Dialog -----------------------------------------------------------------

// ask shows a dialog: { title, text, input, area, ok, danger, cancel }.
// It resolves with the input's value (or true), or null when canceled.
function ask(opts) {
  return new Promise((resolve) => {
    const dlg = $("#dialog");
    $("#dialog-title").textContent = opts.title || "";
    const text = $("#dialog-text");
    text.innerHTML = opts.html ?? esc(opts.text || "");
    text.hidden = !opts.text && !opts.html;
    const input = $("#dialog-input");
    const area = $("#dialog-area");
    input.hidden = opts.input === undefined;
    area.hidden = opts.area === undefined;
    input.value = opts.input ?? "";
    input.type = opts.password ? "password" : "text";
    input.placeholder = opts.placeholder || "";
    area.value = opts.area ?? "";
    area.placeholder = opts.placeholder || "";
    $("#dialog-form").classList.toggle("wide", opts.area !== undefined);
    const ok = $("#dialog-ok");
    ok.textContent = opts.ok || "OK";
    ok.className = opts.danger ? "danger" : "primary";
    $("#dialog-cancel").textContent = opts.cancel || "Annuler";
    dlg.hidden = false;
    setTimeout(() => (!input.hidden ? input : !area.hidden ? area : ok).focus(), 30);
    if (!input.hidden) input.select();
    const done = (v) => {
      dlg.hidden = true;
      $("#dialog-form").onsubmit = null;
      $("#dialog-cancel").onclick = null;
      dlg.onkeydown = null;
      resolve(v);
    };
    $("#dialog-form").onsubmit = (e) => {
      e.preventDefault();
      done(!input.hidden ? input.value : !area.hidden ? area.value : true);
    };
    $("#dialog-cancel").onclick = () => done(null);
    dlg.onkeydown = (e) => {
      if (e.key === "Escape") done(null);
      if (e.key === "Enter" && e.ctrlKey && !area.hidden) $("#dialog-form").requestSubmit();
    };
  });
}

// trustDialog shows a server's key and trusts it when the user agrees.
// It resolves with true once trusted.
async function trustDialog(hk) {
  const v = serverOf(hk.serverId);
  const changed = hk.changed;
  const ok = await ask({
    title: changed ? "La clé du serveur a changé" : "Nouveau serveur",
    html: changed
      ? `<b>${esc(v?.name || hk.host)}</b> présente une clé différente de celle connue. Cela peut venir d'une réinstallation… ou d'une attaque de l'homme du milieu.\n\n<code>${esc(hk.type)}</code>\n<code>${esc(hk.fingerprint)}</code>\n\nRemplacer la clé connue seulement si ce changement est attendu.`
      : `Première connexion à <b>${esc(v?.name || hk.host)}</b> (${esc(hk.host)}). Vérifier que l'empreinte correspond à celle du serveur :\n\n<code>${esc(hk.type)}</code>\n<code>${esc(hk.fingerprint)}</code>`,
    ok: changed ? "Remplacer la clé" : "Faire confiance",
    danger: changed,
  });
  if (!ok) return false;
  try {
    await go("Monitor.TrustHostKey", hk.serverId, hk.host);
    toast("Clé approuvée");
    return true;
  } catch (e) {
    toast(errText(e), true);
    return false;
  }
}

// trustMany shows the keys of new servers and trusts them together. Changed
// keys are left to trustDialog, one by one.
async function trustMany(ids) {
  const hks = ids.map((id) => statusOf(id)?.hostKey).filter(Boolean);
  const fresh = hks.filter((h) => !h.changed);
  const changed = hks.filter((h) => h.changed);
  if (hks.length === 1) return trustDialog(hks[0]);
  if (fresh.length) {
    const rows = fresh.map((h) => `<b>${esc(serverOf(h.serverId)?.name || h.host)}</b> <code>${esc(h.fingerprint)}</code>`).join("\n");
    const ok = await ask({
      title: `${fresh.length} nouveaux serveurs`,
      html: `Première connexion. Vérifier les empreintes :\n\n${rows}`,
      ok: `Faire confiance aux ${fresh.length}`,
    });
    if (ok) {
      let n = 0;
      for (const h of fresh) {
        try {
          await go("Monitor.TrustHostKey", h.serverId, h.host);
          n++;
        } catch (e) {
          toast(`${serverOf(h.serverId)?.name} : ${errText(e)}`, true);
        }
      }
      toast(`${n} clé${n > 1 ? "s" : ""} approuvée${n > 1 ? "s" : ""}`);
    }
  }
  for (const h of changed) await trustDialog(h);
}

// --- Menu -------------------------------------------------------------------

// openMenu shows items ({ label, icon, kbd, danger, disabled, run } or "-",
// or { header }) at x, y.
function openMenu(items, x, y) {
  const menu = $("#menu");
  menu.innerHTML = "";
  for (const it of items) {
    if (it === "-") {
      menu.append(document.createElement("hr"));
      continue;
    }
    if (it.header) {
      const h = document.createElement("div");
      h.className = "menu-label";
      h.textContent = it.header;
      menu.append(h);
      continue;
    }
    const b = document.createElement("button");
    b.className = it.danger ? "danger" : "";
    b.disabled = !!it.disabled;
    b.innerHTML = `${it.icon || ""}<span class="text">${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ""}`;
    b.onclick = () => {
      closeMenu();
      it.run?.();
    };
    menu.append(b);
  }
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
}
function closeMenu() {
  $("#menu").hidden = true;
}
function menuAt(el, items) {
  const r = el.getBoundingClientRect();
  openMenu(items, r.left, r.bottom + 4);
}
addEventListener("mousedown", (e) => {
  if (!$("#menu").hidden && !e.target.closest("#menu")) closeMenu();
});
addEventListener("blur", closeMenu);

// --- Sidebar ----------------------------------------------------------------

function viewServers(view = state.view) {
  let list = state.servers;
  switch (view.type) {
    case "fav":
      list = list.filter((s) => s.favorite);
      break;
    case "recent":
      list = list.filter((s) => s.lastUsed).sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed)).slice(0, 20);
      break;
    case "group":
      list = list.filter((s) => s.group === view.name);
      break;
    case "ungrouped":
      list = list.filter((s) => !s.group);
      break;
  }
  return list;
}
function viewTitle(view = state.view) {
  return { all: "Serveurs", fav: "Favoris", recent: "Récents", ungrouped: "Sans groupe" }[view.type] || view.name;
}
const sameView = (a, b) => a.type === b.type && a.name === b.name;

function countHTML(list) {
  const down = list.filter((s) => isDown(s.id)).length;
  return `<span class="count">${down ? `<span class="down">${down} ↓</span>` : ""}${list.length}</span>`;
}

function renderSidebar() {
  const up = state.servers.filter((s) => isUp(s.id)).length;
  $("#brand-stats").textContent = state.servers.length
    ? `${state.servers.length} serveur${state.servers.length > 1 ? "s" : ""} · ${up} en ligne`
    : "Aucun serveur";

  const views = [
    { type: "all", label: "Tous les serveurs", icon: icons.server },
    { type: "fav", label: "Favoris", icon: icons.star },
    { type: "recent", label: "Récents", icon: icons.clockHist },
  ];
  const home = activeTab()?.kind === "home";
  $("#views").innerHTML = views
    .map((v) => `<a data-view="${v.type}" class="${home && sameView(state.view, v) ? "on" : ""}">${v.icon}<span class="label">${v.label}</span>${countHTML(viewServers(v))}</a>`)
    .join("");

  const ungrouped = state.servers.filter((s) => !s.group);
  $("#groups").innerHTML =
    state.groups
      .map((g) => {
        const v = { type: "group", name: g };
        return `<a data-group="${esc(g)}" class="${home && sameView(state.view, v) ? "on" : ""}">${icons.folder}<span class="label">${esc(g)}</span>${countHTML(viewServers(v))}</a>`;
      })
      .join("") +
    (state.groups.length && ungrouped.length
      ? `<a data-view="ungrouped" class="${home && state.view.type === "ungrouped" ? "on" : ""}">${icons.folder}<span class="label muted">Sans groupe</span>${countHTML(ungrouped)}</a>`
      : "");

  const t = activeTab()?.kind;
  $("#tools").innerHTML =
    `<a data-tool="bulk" class="${t === "bulk" ? "on" : ""}">${icons.bolt}<span class="label">Commandes groupées</span></a>` +
    `<a data-tool="settings" class="${t === "settings" ? "on" : ""}">${icons.gear}<span class="label">Paramètres</span></a>`;
}

function setView(view) {
  state.view = view;
  state.selected.clear();
  openHome();
  renderAll();
}

function initSidebar() {
  $("#new-group").innerHTML = icons.plus;
  $(".quick-icon").innerHTML = icons.search;
  $("#quick").onclick = () => openPalette();
  $("#views").onclick = (e) => {
    const a = e.target.closest("a[data-view]");
    if (a) setView({ type: a.dataset.view });
  };
  $("#groups").onclick = (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    if (a.dataset.group !== undefined) setView({ type: "group", name: a.dataset.group });
    else if (a.dataset.view) setView({ type: a.dataset.view });
  };
  $("#groups").oncontextmenu = (e) => {
    const a = e.target.closest("a[data-group]");
    if (!a) return;
    e.preventDefault();
    const g = a.dataset.group;
    const ids = state.servers.filter((s) => s.group === g).map((s) => s.id);
    openMenu(
      [
        { label: "Ouvrir les terminaux", icon: icons.terminal, disabled: !ids.length, run: () => openTerminals(ids) },
        { label: "Commande groupée", icon: icons.bolt, disabled: !ids.length, run: () => openBulk(ids) },
        "-",
        { label: "Renommer", icon: icons.edit, run: () => renameGroup(g) },
        { label: "Supprimer le groupe", icon: icons.trash, danger: true, run: () => deleteGroup(g) },
      ],
      e.clientX,
      e.clientY,
    );
  };
  // Servers dropped on a group move there.
  $("#groups").ondragover = (e) => {
    const a = e.target.closest("a");
    if (!a || !e.dataTransfer.types.includes("text/gossh-servers")) return;
    e.preventDefault();
    $$("#groups a.drop").forEach((x) => x.classList.remove("drop"));
    a.classList.add("drop");
  };
  $("#groups").ondragleave = (e) => e.target.closest("a")?.classList.remove("drop");
  $("#groups").ondrop = async (e) => {
    const a = e.target.closest("a");
    $$("#groups a.drop").forEach((x) => x.classList.remove("drop"));
    if (!a) return;
    e.preventDefault();
    const ids = JSON.parse(e.dataTransfer.getData("text/gossh-servers") || "[]");
    const group = a.dataset.group ?? "";
    try {
      applyInventory(await go("Servers.SetGroup", ids, group));
      toast(`${ids.length} serveur${ids.length > 1 ? "s" : ""} → ${group || "Sans groupe"}`);
    } catch (err) {
      toast(errText(err), true);
    }
  };
  $("#tools").onclick = (e) => {
    const a = e.target.closest("a[data-tool]");
    if (a?.dataset.tool === "bulk") openBulk();
    if (a?.dataset.tool === "settings") openSettings();
  };
  $("#new-group").onclick = async () => {
    const name = await ask({ title: "Nouveau groupe", input: "", placeholder: "Production", ok: "Créer" });
    if (!name?.trim()) return;
    try {
      applyInventory(await go("Servers.AddGroup", name));
      setView({ type: "group", name: name.trim() });
    } catch (e) {
      toast(errText(e), true);
    }
  };
}

async function renameGroup(g) {
  const name = await ask({ title: "Renommer le groupe", input: g, ok: "Renommer" });
  if (!name?.trim() || name === g) return;
  try {
    applyInventory(await go("Servers.RenameGroup", g, name));
    if (state.view.type === "group" && state.view.name === g) setView({ type: "group", name: name.trim() });
  } catch (e) {
    toast(errText(e), true);
  }
}
async function deleteGroup(g) {
  const n = state.servers.filter((s) => s.group === g).length;
  const ok = await ask({ title: `Supprimer « ${g} » ?`, text: n ? `Ses ${n} serveur${n > 1 ? "s" : ""} restent, sans groupe.` : "", ok: "Supprimer", danger: true });
  if (!ok) return;
  applyInventory(await go("Servers.DeleteGroup", g));
}

// --- Rendering --------------------------------------------------------------

let renderQueued = false;
// renderAll redraws the sidebar, the tab bar and the visible tab, once per
// frame at most.
function renderAll() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderSidebar();
    renderTabs();
    activeTab()?.render?.();
    $("#group-list").innerHTML = state.groups.map((g) => `<option value="${esc(g)}">`).join("");
  });
}

// --- Servers' actions -------------------------------------------------------

async function toggleFavorite(id) {
  const v = serverOf(id);
  if (v) applyInventory(await go("Servers.SetFavorite", id, !v.favorite));
}

async function deleteServers(ids) {
  const names = ids.map((id) => serverOf(id)?.name).filter(Boolean);
  const ok = await ask({
    title: ids.length > 1 ? `Supprimer ${ids.length} serveurs ?` : `Supprimer « ${names[0]} » ?`,
    text: "Leurs terminaux se ferment. Les mots de passe enregistrés sont effacés.",
    ok: "Supprimer",
    danger: true,
  });
  if (!ok) return;
  for (const t of [...state.tabs]) if (ids.includes(t.serverId)) closeTab(t.id);
  applyInventory(await go("Servers.Delete", ids));
  toast(ids.length > 1 ? `${ids.length} serveurs supprimés` : "Serveur supprimé");
}

async function moveServers(ids) {
  const items = [
    { header: "Déplacer vers" },
    ...state.groups.map((g) => ({ label: g, icon: icons.folder, run: () => go("Servers.SetGroup", ids, g).then(applyInventory) })),
    { label: "Sans groupe", icon: icons.folder, run: () => go("Servers.SetGroup", ids, "").then(applyInventory) },
    "-",
    {
      label: "Nouveau groupe…",
      icon: icons.plus,
      run: async () => {
        const name = await ask({ title: "Nouveau groupe", input: "", ok: "Créer" });
        if (name?.trim()) applyInventory(await go("Servers.SetGroup", ids, name));
      },
    },
  ];
  return items;
}

async function tagServers(ids) {
  const tag = await ask({ title: "Ajouter un tag", text: `${ids.length} serveur${ids.length > 1 ? "s" : ""}`, input: "", placeholder: "nginx", ok: "Ajouter" });
  if (tag?.trim()) applyInventory(await go("Servers.AddTag", ids, tag));
}

async function setPassword(ids) {
  const pw = await ask({ title: "Mot de passe", text: `Pour ${ids.length > 1 ? `les ${ids.length} serveurs sélectionnés` : serverOf(ids[0])?.name}. Vide pour l'effacer.`, input: "", password: true, ok: "Enregistrer" });
  if (pw === null) return;
  applyInventory(await go("Servers.SetPassword", ids, pw));
  toast(pw ? "Mot de passe enregistré" : "Mot de passe effacé");
}

async function testServer(id) {
  const v = serverOf(id);
  try {
    const ms = await go("Monitor.Test", id);
    toast(`${v.name} : connexion OK en ${ms} ms`);
  } catch (e) {
    const hk = hostKeyOf(e);
    if (hk) return trustDialog(hk);
    toast(`${v.name} : ${errText(e)}`, true);
  }
}

// serverMenu lists what can be done with servers (one or a selection).
function serverMenu(ids) {
  const one = ids.length === 1 ? serverOf(ids[0]) : null;
  const items = [];
  if (one) {
    items.push(
      { label: "Ouvrir un terminal", icon: icons.terminal, kbd: "Double-clic", run: () => openTerminal(one.id) },
      { label: "Statistiques", icon: icons.chart, run: () => openDetail(one.id) },
      "-",
      { label: "Modifier", icon: icons.edit, run: () => openEditor(one.id) },
      { label: "Dupliquer", icon: icons.copy, run: () => go("Servers.Duplicate", one.id).then(applyInventory) },
      { label: one.favorite ? "Retirer des favoris" : "Ajouter aux favoris", icon: icons.star, run: () => toggleFavorite(one.id) },
      { label: "Copier la commande ssh", icon: icons.copy, run: () => copyText(sshCommand(one)) },
      { label: "Tester la connexion", icon: icons.plug, run: () => testServer(one.id) },
    );
    if (stateOf(one.id) === "hostkey") items.push({ label: "Vérifier la clé…", icon: icons.key, run: () => trustDialog(statusOf(one.id).hostKey) });
  } else {
    items.push(
      { label: `Ouvrir ${ids.length} terminaux`, icon: icons.terminal, run: () => openTerminals(ids) },
      { label: "Commande groupée", icon: icons.bolt, run: () => openBulk(ids) },
    );
    const keys = ids.filter((id) => stateOf(id) === "hostkey");
    if (keys.length) items.push({ label: `Vérifier ${keys.length} clé${keys.length > 1 ? "s" : ""}…`, icon: icons.key, run: () => trustMany(keys) });
  }
  items.push(
    "-",
    { label: "Déplacer vers…", icon: icons.folder, run: async () => openMenu(await moveServers(ids), lastMouse.x, lastMouse.y) },
    { label: "Ajouter un tag…", icon: icons.tag, run: () => tagServers(ids) },
    { label: "Définir le mot de passe…", icon: icons.key, run: () => setPassword(ids) },
  );
  const monitored = ids.every((id) => serverOf(id)?.monitor);
  items.push(
    { label: monitored ? "Arrêter les statistiques" : "Relever les statistiques", icon: icons.chart, run: () => go("Servers.SetMonitor", ids, !monitored).then(applyInventory) },
    { label: "Rafraîchir", icon: icons.refresh, run: () => go("Monitor.Refresh", ids) },
    { label: "Déconnecter", icon: icons.unlink, run: () => go("Monitor.Disconnect", ids).then(() => toast("Déconnecté")) },
    "-",
    { label: "Supprimer", icon: icons.trash, danger: true, run: () => deleteServers(ids) },
  );
  return items;
}

const lastMouse = { x: 0, y: 0 };
addEventListener("mousemove", (e) => {
  lastMouse.x = e.clientX;
  lastMouse.y = e.clientY;
});

function sshCommand(v) {
  return `ssh ${v.port && v.port !== 22 ? `-p ${v.port} ` : ""}${v.keyPath ? `-i "${v.keyPath}" ` : ""}${v.user ? v.user + "@" : ""}${v.host}`;
}
async function copyText(text) {
  try {
    await go("App.WriteClipboard", text);
    toast("Copié");
  } catch (e) {
    toast(errText(e), true);
  }
}
