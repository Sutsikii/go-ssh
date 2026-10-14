"use strict";

// Tabs: the server list (pinned, always first), terminals, statistics, the
// bulk commands and the settings. Each tab object has a kind, a pane and
// optional hooks: render, show, hide, destroy, status (a server's new
// status), label and icon.

let tabSeq = 0;
const activeTab = () => state.tabs.find((t) => t.id === state.active);
const tabsOf = (kind) => state.tabs.filter((t) => t.kind === kind);

// addTab adds a tab after the tab after, the active one by default for
// terminals; other tabs go at the end.
function addTab(tab, activate = true, after = null) {
  tab.id = ++tabSeq;
  tab.pane.dataset.tab = tab.id;
  $("#panes").append(tab.pane);
  const cur = state.tabs.findIndex((t) => t.id === (after?.id ?? state.active));
  if (tab.kind === "term" && cur >= 0) state.tabs.splice(cur + 1, 0, tab);
  else state.tabs.push(tab);
  if (activate) activateTab(tab.id);
  else renderAll();
  return tab;
}

function activateTab(id) {
  const prev = activeTab();
  const next = state.tabs.find((t) => t.id === id);
  if (!next) return;
  if (prev && prev !== next) prev.hide?.();
  state.active = id;
  next.activity = false;
  layoutPanes();
  next.show?.();
  next.render?.();
  renderSidebar();
  renderTabs();
  $(`.tab[data-id="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function closeTab(id) {
  const i = state.tabs.findIndex((t) => t.id === id);
  const t = state.tabs[i];
  if (!t || t.kind === "home") return;
  t.destroy?.();
  t.pane.remove();
  state.tabs.splice(i, 1);
  if (state.active === id) {
    const next = state.tabs[Math.min(i, state.tabs.length - 1)];
    state.active = null;
    activateTab((state.tiled && t.kind === "term" && tabsOf("term")[0]?.id) || next.id);
  } else {
    layoutPanes();
    renderTabs();
  }
  if (state.tiled && !tabsOf("term").length) setTiled(false);
}

// layoutPanes shows the active tab, or every terminal in tiled mode.
function layoutPanes() {
  const terms = tabsOf("term");
  const act = activeTab();
  const tiled = state.tiled && terms.length > 0 && act?.kind === "term";
  const panes = $("#panes");
  panes.classList.toggle("tiled", tiled);
  if (tiled) {
    const cols = terms.length <= 3 ? terms.length : Math.ceil(Math.sqrt(terms.length));
    panes.style.setProperty("--cols", cols);
    // Panes follow the tabs' order.
    for (const t of terms) panes.append(t.pane);
  }
  for (const t of state.tabs) {
    t.pane.classList.toggle("on", tiled ? t.kind === "term" : t === act);
    t.pane.classList.toggle("focus", tiled && t === act);
  }
  if (tiled) for (const t of terms) t.fit?.();
}

const kindIcons = { term: icons.terminal, detail: icons.chart, bulk: icons.bolt, settings: icons.gear };

function renderTabs() {
  const el = $("#tabs");
  el.innerHTML = state.tabs
    .map((t) => {
      const v = t.serverId ? serverOf(t.serverId) : null;
      const label = t.label?.() ?? "";
      const dot = t.kind === "term" ? `<i class="dot ${t.stateClass()}"></i>` : "";
      const color = v?.color ? `<i class="tab-color" style="background:${v.color}"></i>` : "";
      return t.kind === "home"
        ? `<div class="tab pinned ${t.id === state.active ? "on" : ""}" data-id="${t.id}" title="Serveurs">${icons.all}<span class="label">Serveurs</span></div>`
        : `<div class="tab ${t.id === state.active ? "on" : ""}" data-id="${t.id}" draggable="true" title="${esc(label)}">${color}${dot || `<span class="kind">${kindIcons[t.kind] || ""}</span>`}<span class="label">${esc(label)}</span>${t.activity ? '<i class="activity"></i>' : ""}<button class="x" aria-label="Fermer">${icons.close}</button></div>`;
    })
    .join("");
  const nTerms = tabsOf("term").length;
  $("#tile-toggle").classList.toggle("on", state.tiled);
  $("#tile-toggle").disabled = nTerms < 2 && !state.tiled;
  $("#broadcast-toggle").classList.toggle("on", state.broadcast);
  $("#broadcast-toggle").disabled = !nTerms && !state.broadcast;
  const bb = $("#broadcast-bar");
  bb.hidden = !state.broadcast;
  if (state.broadcast) {
    const n = tabsOf("term").filter((t) => t.connected).length;
    bb.innerHTML = `${icons.broadcast}<span>La saisie est envoyée à <b>${n}</b> ${n > 1 ? "terminaux connectés" : "terminal connecté"}.</span><div class="spacer"></div><button class="ghost" id="broadcast-off">Arrêter</button>`;
    $("#broadcast-off").onclick = () => setBroadcast(false);
  }
}

function initTabs() {
  $("#tile-toggle").innerHTML = icons.tile;
  $("#broadcast-toggle").innerHTML = icons.broadcast;
  $("#new-tab").innerHTML = icons.plus;
  $("#new-tab").onclick = () => openPalette();
  $("#tile-toggle").onclick = () => setTiled(!state.tiled);
  $("#broadcast-toggle").onclick = () => setBroadcast(!state.broadcast);
  const el = $("#tabs");
  el.onmousedown = (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    if (e.button === 1) {
      e.preventDefault();
      closeTab(+tab.dataset.id);
    } else if (e.button === 0 && !e.target.closest(".x")) activateTab(+tab.dataset.id);
  };
  el.onclick = (e) => {
    const x = e.target.closest(".x");
    if (x) closeTab(+x.closest(".tab").dataset.id);
  };
  el.oncontextmenu = (e) => {
    const el = e.target.closest(".tab");
    if (!el) return;
    e.preventDefault();
    const t = state.tabs.find((t) => t.id === +el.dataset.id);
    if (!t || t.kind === "home") return;
    const others = state.tabs.filter((o) => o !== t && o.kind !== "home");
    const items = [];
    if (t.serverId) {
      items.push(
        { label: "Nouveau terminal sur ce serveur", icon: icons.terminal, run: () => openTerminal(t.serverId) },
        { label: "Statistiques", icon: icons.chart, run: () => openDetail(t.serverId) },
      );
      if (t.kind === "term") items.push({ label: "Reconnecter", icon: icons.refresh, run: () => t.reconnect() });
      items.push("-");
    }
    items.push(
      { label: "Fermer", icon: icons.close, kbd: "Ctrl+Maj+W", run: () => closeTab(t.id) },
      { label: "Fermer les autres", disabled: !others.length, run: () => others.forEach((o) => closeTab(o.id)) },
      { label: "Fermer les onglets à droite", run: () => state.tabs.slice(state.tabs.indexOf(t) + 1).forEach((o) => closeTab(o.id)) },
      { label: "Fermer tous les terminaux", danger: true, disabled: !tabsOf("term").length, run: () => tabsOf("term").forEach((o) => closeTab(o.id)) },
    );
    openMenu(items, e.clientX, e.clientY);
  };
  // Reorder by dragging.
  let dragged = null;
  el.ondragstart = (e) => {
    const tab = e.target.closest(".tab");
    dragged = +tab?.dataset.id;
    tab?.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  };
  el.ondragend = () => {
    dragged = null;
    renderTabs();
  };
  el.ondragover = (e) => {
    if (!dragged) return;
    e.preventDefault();
    $$(".tab.drop-before", el).forEach((x) => x.classList.remove("drop-before"));
    const over = e.target.closest(".tab:not(.pinned)");
    over?.classList.add("drop-before");
  };
  el.ondrop = (e) => {
    const over = e.target.closest(".tab:not(.pinned)");
    if (!dragged || !over) return;
    e.preventDefault();
    const from = state.tabs.findIndex((t) => t.id === dragged);
    const [t] = state.tabs.splice(from, 1);
    const to = state.tabs.findIndex((x) => x.id === +over.dataset.id);
    state.tabs.splice(to, 0, t);
    layoutPanes();
    renderTabs();
  };
}

function setTiled(on) {
  state.tiled = on && tabsOf("term").length > 0;
  if (state.tiled && activeTab()?.kind !== "term") activateTab(tabsOf("term")[0].id);
  layoutPanes();
  renderTabs();
  activeTab()?.focus?.();
}
function setBroadcast(on) {
  state.broadcast = on;
  renderTabs();
  activeTab()?.focus?.();
}

function cycleTab(dir) {
  const i = state.tabs.findIndex((t) => t.id === state.active);
  const n = state.tabs.length;
  activateTab(state.tabs[(i + dir + n) % n].id);
}

// --- Openers ----------------------------------------------------------------

function openHome() {
  activateTab(tabsOf("home")[0].id);
}
function openDetail(serverId) {
  const t = state.tabs.find((t) => t.kind === "detail" && t.serverId === serverId);
  if (t) return activateTab(t.id);
  addTab(newDetailTab(serverId));
}
function openTerminal(serverId, activate = true, after = null) {
  return addTab(newTermTab(serverId), activate, after);
}
function openTerminals(ids) {
  if (ids.length > 24) {
    ask({ title: `Ouvrir ${ids.length} terminaux ?`, text: "Cela fait beaucoup d'onglets. La commande groupée est souvent plus pratique.", ok: "Ouvrir" }).then((ok) => ok && openTerminalsNow(ids));
    return;
  }
  openTerminalsNow(ids);
}
function openTerminalsNow(ids) {
  let first = null, last = null;
  for (const id of ids) {
    last = openTerminal(id, false, last);
    first ??= last;
  }
  if (first) {
    if (ids.length > 1 && !state.tiled) setTiled(true);
    activateTab(first.id);
  }
}
function openBulk(ids) {
  let t = tabsOf("bulk")[0];
  if (!t) t = addTab(newBulkTab(), false);
  if (ids?.length) t.select(ids);
  activateTab(t.id);
}
function openSettings() {
  const t = tabsOf("settings")[0];
  if (t) return activateTab(t.id);
  addTab(newSettingsTab());
}

// --- Quick connect ----------------------------------------------------------

const palette = { items: [], pos: 0 };

function openPalette() {
  $("#palette").hidden = false;
  const input = $("#palette-input");
  input.value = "";
  renderPalette();
  input.focus();
}
function closePalette() {
  $("#palette").hidden = true;
  activeTab()?.focus?.();
}
function paletteMatches(q) {
  q = q.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const v of state.servers) {
    const hay = [v.name, v.host, v.user, v.group, ...(v.tags || []), statusOf(v.id)?.info?.hostname].join(" ").toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    let score = v.name.toLowerCase().startsWith(q) ? 3 : 0;
    if (v.favorite) score += 1;
    if (v.lastUsed) score += Math.max(0, 1 - (Date.now() - new Date(v.lastUsed)) / 864e6);
    scored.push({ v, score });
  }
  scored.sort((a, b) => b.score - a.score || a.v.name.localeCompare(b.v.name));
  return scored.map((s) => s.v);
}
function renderPalette() {
  const q = $("#palette-input").value;
  const list = paletteMatches(q).slice(0, 50);
  const items = list.map((v) => ({ kind: "server", v }));
  // "user@host:port" connects to a new server.
  if (/^[^\s@]+@[^\s]+$|^[\w.-]+\.[\w.-]+(:\d+)?$|^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(q.trim()) && !list.some((v) => addr(v) === q.trim())) {
    items.push({ kind: "new", text: q.trim() });
  }
  if (!q.trim()) {
    items.push({ kind: "action", label: "Ajouter un serveur", icon: icons.plus, run: () => openEditor() });
    items.push({ kind: "action", label: "Commandes groupées", icon: icons.bolt, run: () => openBulk() });
  }
  palette.items = items;
  palette.pos = Math.min(palette.pos, Math.max(0, items.length - 1));
  if (q !== palette.q) palette.pos = 0;
  palette.q = q;
  $("#palette-list").innerHTML = items.length
    ? items
        .map((it, i) => {
          const on = i === palette.pos ? "on" : "";
          if (it.kind === "server")
            return `<div class="palette-item ${on}" data-i="${i}"><i class="dot ${stateOf(it.v.id)}"></i><b>${esc(it.v.name)}</b><span class="addr">${esc(addr(it.v))}</span>${it.v.group ? `<span class="tag grp">${esc(it.v.group)}</span>` : ""}</div>`;
          if (it.kind === "new") return `<div class="palette-item ${on}" data-i="${i}">${icons.plus}<b>Ajouter et se connecter</b><span class="addr">${esc(it.text)}</span></div>`;
          return `<div class="palette-item ${on}" data-i="${i}">${it.icon}<b>${esc(it.label)}</b></div>`;
        })
        .join("")
    : `<div class="palette-empty">Aucun serveur ne correspond.</div>`;
  $(".palette-item.on")?.scrollIntoView({ block: "nearest" });
}
async function runPalette(i, stats) {
  const it = palette.items[i];
  if (!it) return;
  closePalette();
  if (it.kind === "server") return stats ? openDetail(it.v.id) : openTerminal(it.v.id);
  if (it.kind === "action") return it.run();
  try {
    const r = await go("Servers.AddMany", it.text, state.view.type === "group" ? state.view.name : "");
    applyInventory(r.inventory);
    if (r.errors.length) return toast(r.errors[0], true);
    const v = paletteMatches(it.text.replace(/:\d+$/, "").split("@").pop())[0];
    if (v) openEditor(v.id, { thenConnect: true });
  } catch (e) {
    toast(errText(e), true);
  }
}
function initPalette() {
  const input = $("#palette-input");
  input.oninput = renderPalette;
  input.onkeydown = (e) => {
    const n = palette.items.length;
    if (e.key === "ArrowDown") palette.pos = (palette.pos + 1) % Math.max(n, 1);
    else if (e.key === "ArrowUp") palette.pos = (palette.pos - 1 + n) % Math.max(n, 1);
    else if (e.key === "Enter") return runPalette(palette.pos, e.shiftKey);
    else if (e.key === "Escape") return closePalette();
    else return;
    e.preventDefault();
    renderPalette();
  };
  $("#palette-list").onclick = (e) => {
    const it = e.target.closest(".palette-item");
    if (it) runPalette(+it.dataset.i, e.shiftKey);
  };
  $("#palette").onmousedown = (e) => {
    if (e.target.id === "palette") closePalette();
  };
}

// --- Shortcuts --------------------------------------------------------------

// appShortcut handles the app's keys; terminals pass theirs here first. It
// returns true when it used the key.
function appShortcut(e) {
  const k = e.key.toLowerCase();
  if (e.ctrlKey && !e.altKey && (k === "k" || (k === "t" && !e.shiftKey))) {
    openPalette();
    return true;
  }
  if (e.ctrlKey && e.shiftKey && k === "w") {
    const t = activeTab();
    if (t && t.kind !== "home") closeTab(t.id);
    return true;
  }
  if (e.ctrlKey && k === "w" && activeTab()?.kind !== "term") {
    const t = activeTab();
    if (t && t.kind !== "home") closeTab(t.id);
    return true;
  }
  if (e.ctrlKey && k === "tab") {
    cycleTab(e.shiftKey ? -1 : 1);
    return true;
  }
  if (e.ctrlKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
    const t = e.key === "9" ? state.tabs.at(-1) : state.tabs[+e.key - 1];
    if (t) activateTab(t.id);
    return true;
  }
  if (e.ctrlKey && e.shiftKey && k === "m") {
    setTiled(!state.tiled);
    return true;
  }
  if (e.ctrlKey && e.shiftKey && k === "b") {
    setBroadcast(!state.broadcast);
    return true;
  }
  if (e.ctrlKey && k === ",") {
    openSettings();
    return true;
  }
  return false;
}

function initShortcuts() {
  addEventListener("keydown", (e) => {
    if (!$("#dialog").hidden || !$("#editor").hidden || !$("#palette").hidden) return;
    if (e.target.closest?.(".xterm")) return; // terminals call appShortcut themselves
    if (appShortcut(e)) {
      e.preventDefault();
      return;
    }
    activeTab()?.key?.(e);
  });
}
