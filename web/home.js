"use strict";

// The server list: cards or a table, with live meters, selection for bulk
// actions, and an overview of the fleet.

const spark = new Map(); // server ID → last CPU values, for the cards

function newHomeTab() {
  const pane = $("#tpl-home").content.firstElementChild.cloneNode(true);
  const tab = { kind: "home", pane, search: "", filter: "", lastClicked: null };
  const q = (s) => $(s, pane);

  q(".add-server").onclick = (e) =>
    menuAt(e.currentTarget, [
      { label: "Nouveau serveur", icon: icons.plus, run: () => openEditor() },
      { label: "Ajout en lot…", icon: icons.list, run: () => addMany() },
      "-",
      { label: "Importer ~/.ssh/config", icon: icons.import, run: () => importSSHConfig() },
      { label: "Importer un fichier…", icon: icons.import, run: () => importFile() },
    ]);
  q(".home-search").oninput = (e) => {
    tab.search = e.target.value;
    tab.render();
  };
  q(".state-filter").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    tab.filter = b.dataset.state;
    $$("button", q(".state-filter")).forEach((x) => x.classList.toggle("on", x === b));
    tab.render();
  };
  const sw = q(".layout-switch");
  $('[data-layout="cards"]', sw).innerHTML = icons.all;
  $('[data-layout="list"]', sw).innerHTML = icons.list;
  sw.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    prefs.layout = b.dataset.layout;
    savePrefs();
    tab.render();
  };

  // The servers shown, in order.
  tab.visible = () => {
    let list = viewServers();
    const words = tab.search.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length)
      list = list.filter((v) => {
        const st = statusOf(v.id);
        const hay = [v.name, v.host, v.user, v.group, v.notes, ...(v.tags || []), st?.info?.hostname, st?.info?.os, ...(st?.info?.ips || [])].join(" ").toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    if (tab.filter === "online") list = list.filter((v) => isUp(v.id));
    if (tab.filter === "down") list = list.filter((v) => isDown(v.id));
    if (prefs.layout === "list") list = sortList(list);
    return list;
  };

  tab.render = () => {
    q(".home-title").textContent = viewTitle();
    $$("button", sw).forEach((b) => b.classList.toggle("on", b.dataset.layout === prefs.layout));
    renderOverview(q(".overview"), viewServers());
    renderNotice(q(".notice"), viewServers());
    const list = tab.visible();
    const empty = q(".empty");
    const grid = q(".server-grid");
    const table = q(".server-list");
    const none = !state.servers.length;
    empty.hidden = list.length > 0;
    q(".overview").hidden = none;
    if (!list.length) {
      grid.hidden = table.hidden = true;
      empty.innerHTML = none
        ? `<div class="empty-icon">${icons.server}</div><b>Aucun serveur</b><p>Ajouter un serveur, en coller une liste (un <code>user@hôte:port</code> par ligne) ou reprendre ceux de <code>~/.ssh/config</code>.</p>
           <div class="settings-row"><button class="primary" data-act="add">Ajouter un serveur</button><button data-act="many">Ajout en lot</button><button data-act="import">Importer ~/.ssh/config</button></div>`
        : `<div class="empty-icon">${icons.search}</div><b>Rien ici</b><p>Aucun serveur ne correspond à cette vue ou à cette recherche.</p>`;
      empty.onclick = (e) => {
        const a = e.target.closest("[data-act]")?.dataset.act;
        if (a === "add") openEditor();
        if (a === "many") addMany();
        if (a === "import") importSSHConfig();
      };
    } else if (prefs.layout === "list") {
      grid.hidden = true;
      table.hidden = false;
      renderTable(table, list);
    } else {
      table.hidden = true;
      grid.hidden = false;
      renderCards(grid, list);
    }
    renderSelectionBar(q(".selection-bar"));
  };

  tab.status = () => scheduleHome();

  // Clicks on cards and rows.
  const itemOf = (e) => e.target.closest("[data-id]");
  const onClick = (e) => {
    const el = itemOf(e);
    if (!el || e.target.closest("button:not(.check)")) return;
    const id = el.dataset.id;
    if (e.target.closest(".check") || e.ctrlKey || e.metaKey) toggleSelect(id);
    else if (e.shiftKey && tab.lastClicked) {
      const ids = tab.visible().map((v) => v.id);
      const [a, b] = [ids.indexOf(tab.lastClicked), ids.indexOf(id)].sort((x, y) => x - y);
      for (const x of ids.slice(a, b + 1)) state.selected.add(x);
    } else if (state.selected.size) toggleSelect(id);
    else openDetail(id);
    tab.lastClicked = id;
    tab.render();
  };
  const onDouble = (e) => {
    const el = itemOf(e);
    if (!el || e.target.closest("button")) return;
    state.selected.delete(el.dataset.id);
    openTerminal(el.dataset.id);
  };
  const onAction = (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    e.stopPropagation();
    const id = itemOf(e).dataset.id;
    ({ term: () => openTerminal(id), stats: () => openDetail(id), fav: () => toggleFavorite(id), more: () => menuAt(b, serverMenu([id])), key: () => trustDialog(statusOf(id).hostKey) })[b.dataset.act]?.();
  };
  const onMenu = (e) => {
    const el = itemOf(e);
    if (!el) return;
    e.preventDefault();
    const id = el.dataset.id;
    const ids = state.selected.has(id) ? [...state.selected] : [id];
    openMenu(serverMenu(ids), e.clientX, e.clientY);
  };
  const onDrag = (e) => {
    const el = itemOf(e);
    if (!el) return;
    const ids = state.selected.has(el.dataset.id) ? [...state.selected] : [el.dataset.id];
    e.dataTransfer.setData("text/gossh-servers", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
  };
  for (const c of [q(".server-grid"), q(".server-list")]) {
    c.addEventListener("click", onAction, true);
    c.onclick = onClick;
    c.ondblclick = onDouble;
    c.oncontextmenu = onMenu;
    c.ondragstart = onDrag;
  }
  q(".server-list").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    if (prefs.listSort === th.dataset.sort) prefs.listDesc = !prefs.listDesc;
    else {
      prefs.listSort = th.dataset.sort;
      prefs.listDesc = ["cpu", "mem", "disk", "load"].includes(th.dataset.sort);
    }
    savePrefs();
    tab.render();
  });

  tab.key = (e) => {
    if (e.target.matches("input, textarea, select")) {
      if (e.key === "Escape") e.target.blur();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      for (const v of tab.visible()) state.selected.add(v.id);
      tab.render();
    } else if (e.ctrlKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      q(".home-search").focus();
    } else if (e.key === "Escape" && state.selected.size) {
      state.selected.clear();
      tab.render();
    } else if (e.key === "Delete" && state.selected.size) deleteServers([...state.selected]);
    else if (e.key === "Enter" && state.selected.size) openTerminals([...state.selected]);
    else if (e.key === "n" && !e.ctrlKey) openEditor();
  };
  return tab;
}

let homeTimer = null;
// scheduleHome redraws the server list after statistics arrive, twice a
// second at most.
function scheduleHome() {
  if (homeTimer) return;
  homeTimer = setTimeout(() => {
    homeTimer = null;
    renderSidebar();
    if (activeTab()?.kind === "home") activeTab().render();
  }, 500);
}

function toggleSelect(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
}

function renderOverview(el, list) {
  const up = list.filter((v) => isUp(v.id));
  const down = list.filter((v) => isDown(v.id)).length;
  let cpu = 0, mem = 0, memTotal = 0, n = 0;
  let worst = null;
  for (const v of up) {
    const st = statusOf(v.id);
    if (!st?.latest) continue;
    n++;
    cpu += st.latest.cpu;
    mem += st.latest.memUsed;
    memTotal += st.latest.memTotal;
    const d = fullestDisk(st);
    if (d && (!worst || d.used / d.total > worst.p)) worst = { p: d.used / d.total, v, d };
  }
  el.innerHTML = `
    <div class="ov"><b><span class="ok">${up.length}</span><small> / ${list.length}</small></b><span>en ligne</span></div>
    <div class="ov"><b class="${down ? "bad" : ""}">${down}</b><span>hors ligne ou à vérifier</span></div>
    <div class="ov"><b>${n ? pctText(cpu / n) : "–"}</b><span>CPU moyen</span></div>
    <div class="ov"><b>${memTotal ? sizeText(mem, 1) : "–"}</b><span>${memTotal ? `mémoire utilisée sur ${sizeText(memTotal)}` : "mémoire"}</span></div>
    <div class="ov"><b class="${worst && worst.p > 0.9 ? "bad" : ""}">${worst ? pctText(worst.p * 100) : "–"}</b><span>${worst ? `disque le plus plein · ${esc(worst.v.name)} ${esc(worst.d.mount)}` : "disque le plus plein"}</span></div>`;
}

// renderNotice offers to check the keys of new servers, all at once.
function renderNotice(el, list) {
  const pending = list.filter((v) => stateOf(v.id) === "hostkey");
  el.hidden = !pending.length;
  if (!pending.length) return;
  const changed = pending.filter((v) => statusOf(v.id).hostKey?.changed).length;
  el.innerHTML = `${icons.key}<span><b>${pending.length} serveur${pending.length > 1 ? "s" : ""}</b> attend${pending.length > 1 ? "ent" : ""} la vérification de ${pending.length > 1 ? "leur" : "sa"} clé d'hôte${changed ? ` (dont ${changed} clé${changed > 1 ? "s" : ""} changée${changed > 1 ? "s" : ""})` : ""}.</span><button class="primary">Vérifier les clés</button>`;
  $("button", el).onclick = () => trustMany(pending.map((v) => v.id));
}

function sparkSVG(id) {
  const vals = spark.get(id) || [];
  if (vals.length < 2) return `<svg class="spark" viewBox="0 0 100 34" preserveAspectRatio="none"></svg>`;
  // The scale follows the values, from 0 to at least 20%.
  const top = Math.min(100, Math.max(20, ...vals) * 1.15);
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * 100).toFixed(2)},${(32 - (Math.min(v, top) / top) * 30).toFixed(2)}`);
  return `<svg class="spark" viewBox="0 0 100 34" preserveAspectRatio="none">
    <defs><linearGradient id="sg-${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--c1)" stop-opacity=".28"/><stop offset="1" stop-color="var(--c1)" stop-opacity="0"/></linearGradient></defs>
    <path d="M0,34 L${pts.join(" L")} L100,34 Z" fill="url(#sg-${id})"/>
    <path d="M${pts.join(" L")}" fill="none" stroke="var(--c1)" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
}

function cardHTML(v) {
  const st = statusOf(v.id);
  const s = stateOf(v.id);
  const l = st?.latest;
  const sel = state.selected.has(v.id);
  const disk = fullestDisk(st);
  let body = "";
  if (s === "online" && l) {
    const mem = pct(l.memUsed, l.memTotal);
    const dp = disk ? pct(disk.used, disk.total) : 0;
    body = `<div class="meters">
      <div class="meter"><span>CPU</span>${bar(l.cpu, "")}<em>${pctText(l.cpu)}</em></div>
      <div class="meter"><span>RAM</span>${bar(mem)}<em>${pctText(mem)}</em></div>
      <div class="meter"><span>Disque</span>${bar(dp)}<em>${disk ? pctText(dp) : "–"}</em></div>
    </div>${sparkSVG(v.id)}`;
  } else if (s === "online") body = `<div class="card-msg dim">${esc(st?.error || "Connecté")}</div>`;
  else if (s === "hostkey") body = `<div class="card-msg key">${st.hostKey?.changed ? "La clé du serveur a changé." : "Première connexion : vérifier l'empreinte du serveur."}</div>`;
  else if (s === "offline") body = `<div class="card-msg">${esc(st?.error || "Injoignable")}</div>`;
  else if (s === "off") body = `<div class="card-msg dim">Statistiques désactivées.</div>`;
  else body = `<div class="card-msg dim">Connexion…</div>`;
  const os = st?.info?.os ? ` · <span>${esc(st.info.os)}</span>` : "";
  const stamp = s === "online" && st ? `up ${durationText(st.uptime)} · ${st.latency} ms` : s === "offline" && st?.lastSeen ? `vu ${agoText(st.lastSeen)}` : "";
  return `<article class="card ${sel ? "selected" : ""}" data-id="${v.id}" draggable="true" style="${v.color ? `--card-color:${v.color}` : ""}">
    <div class="card-head"><i class="dot ${s}" title="${stateLabels[s]}"></i><b>${esc(v.name)}</b>
      <button class="star ${v.favorite ? "on" : ""}" data-act="fav" title="Favori">${v.favorite ? icons.starOn : icons.star}</button>
      <span class="check" role="checkbox" aria-checked="${sel}">${icons.check}</span></div>
    <div class="card-sub">${esc(addr(v))}${os}</div>
    ${body}
    <div class="card-foot"><div class="tags">${state.view.type !== "group" && !grouped() && v.group ? `<span class="tag">${esc(v.group)}</span>` : ""}${(v.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div><span class="stamp">${stamp}</span></div>
    <div class="card-actions">${s === "hostkey" ? `<button data-act="key">${icons.key}Vérifier</button>` : `<button data-act="stats" title="Statistiques">${icons.chart}</button><button data-act="term" class="primary">${icons.terminal}Terminal</button>`}<button data-act="more" title="Plus">${icons.more}</button></div>
  </article>`;
}

// In "all", servers are shown by group.
const grouped = () => state.view.type === "all" && state.groups.length > 0 && prefs.layout === "cards";

function renderCards(grid, list) {
  grid.classList.toggle("selecting", state.selected.size > 0);
  if (grouped() && list.length > 1) {
    const by = new Map();
    for (const v of list) {
      const g = v.group || "";
      if (!by.has(g)) by.set(g, []);
      by.get(g).push(v);
    }
    const order = [...state.groups.filter((g) => by.has(g)), ...(by.has("") ? [""] : [])];
    grid.innerHTML = order
      .map((g) => `<div class="group-title">${esc(g || "Sans groupe")} <i>${by.get(g).length}</i></div>` + by.get(g).map(cardHTML).join(""))
      .join("");
  } else grid.innerHTML = list.map(cardHTML).join("");
}

const listColumns = [
  { key: "name", label: "Nom" },
  { key: "addr", label: "Adresse" },
  { key: "group", label: "Groupe" },
  { key: "os", label: "Système" },
  { key: "cpu", label: "CPU", num: true },
  { key: "mem", label: "RAM", num: true },
  { key: "disk", label: "Disque", num: true },
  { key: "load", label: "Charge", num: true },
  { key: "uptime", label: "Uptime", num: true },
  { key: "latency", label: "Latence", num: true },
];

function listValue(v, key) {
  const st = statusOf(v.id);
  const l = isUp(v.id) ? st?.latest : null;
  switch (key) {
    case "name": return v.name.toLowerCase();
    case "addr": return addr(v);
    case "group": return v.group || "";
    case "os": return st?.info?.os || "";
    case "cpu": return l ? l.cpu : -1;
    case "mem": return l ? pct(l.memUsed, l.memTotal) : -1;
    case "disk": {
      const d = l && fullestDisk(st);
      return d ? pct(d.used, d.total) : -1;
    }
    case "load": return l ? l.load1 : -1;
    case "uptime": return l ? st.uptime : -1;
    case "latency": return isUp(v.id) ? st.latency : 1e9;
  }
}
function sortList(list) {
  const k = prefs.listSort;
  const dir = prefs.listDesc ? -1 : 1;
  return [...list].sort((a, b) => {
    const x = listValue(a, k), y = listValue(b, k);
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir || a.name.localeCompare(b.name);
  });
}

function renderTable(el, list) {
  const head = listColumns
    .map((c) => `<th data-sort="${c.key}" class="col-${c.key} ${c.num ? "num" : ""} ${prefs.listSort === c.key ? "sorted" : ""}">${c.label}${prefs.listSort === c.key ? (prefs.listDesc ? " ↓" : " ↑") : ""}</th>`)
    .join("");
  const rows = list
    .map((v) => {
      const st = statusOf(v.id);
      const s = stateOf(v.id);
      const l = s === "online" ? st?.latest : null;
      const d = l && fullestDisk(st);
      const mem = l ? pct(l.memUsed, l.memTotal) : 0;
      const dp = d ? pct(d.used, d.total) : 0;
      const sel = state.selected.has(v.id);
      const mini = (val) => `<span class="mini">${bar(val)}<span>${pctText(val)}</span></span>`;
      return `<tr class="row ${sel ? "selected" : ""}" data-id="${v.id}" draggable="true">
        <td><span class="check">${icons.check}</span></td>
        <td class="name"><i class="dot ${s}" title="${stateLabels[s]}"></i> ${esc(v.name)}</td>
        <td class="addr">${esc(addr(v))}</td>
        <td class="col-group">${v.group ? `<span class="tag">${esc(v.group)}</span>` : ""}</td>
        <td class="muted col-os">${s === "online" ? esc(st?.info?.os || "") : `<span class="${s === "off" || s === "connecting" ? "" : "warn"}" title="${esc(st?.error || "")}">${stateLabels[s]}</span>`}</td>
        <td class="num">${l ? mini(l.cpu) : "–"}</td>
        <td class="num">${l ? mini(mem) : "–"}</td>
        <td class="num">${d ? mini(dp) : "–"}</td>
        <td class="num">${l ? l.load1.toFixed(2) : "–"}</td>
        <td class="num">${l ? durationText(st.uptime) : "–"}</td>
        <td class="num col-latency">${s === "online" ? st.latency + " ms" : "–"}</td>
        <td class="acts"><button data-act="term">${icons.terminal}</button><button data-act="more">${icons.more}</button></td>
      </tr>`;
    })
    .join("");
  el.classList.toggle("selecting", state.selected.size > 0);
  el.innerHTML = `<table><thead><tr><th style="width:30px"></th>${head}<th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSelectionBar(el) {
  const n = state.selected.size;
  el.hidden = !n;
  if (!n) return;
  const ids = [...state.selected];
  el.innerHTML = `<span>${n} sélectionné${n > 1 ? "s" : ""}</span>
    <button data-act="term">${icons.terminal}Terminaux</button>
    <button data-act="bulk" class="primary">${icons.bolt}Commande</button>
    <button data-act="move">${icons.folder}Déplacer</button>
    <button data-act="more">${icons.more}</button>
    <button data-act="clear" class="ghost">Annuler</button>`;
  el.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "term") openTerminals(ids);
    if (act === "bulk") openBulk(ids);
    if (act === "move") menuAt(b, await moveServers(ids));
    if (act === "more") menuAt(b, serverMenu(ids));
    if (act === "clear") {
      state.selected.clear();
      activeTab()?.render();
    }
  };
}

// --- Adding servers ---------------------------------------------------------

function importReport(r, what) {
  applyInventory(r.inventory);
  const parts = [`${r.added} ajouté${r.added > 1 ? "s" : ""}`];
  if (r.skipped) parts.push(`${r.skipped} déjà présent${r.skipped > 1 ? "s" : ""}`);
  if (r.errors.length) parts.push(`${r.errors.length} erreur${r.errors.length > 1 ? "s" : ""}`);
  toast(`${what} : ${parts.join(", ")}`, r.errors.length > 0 && !r.added);
  if (r.errors.length) setTimeout(() => toast(r.errors.slice(0, 3).join("\n"), true), 400);
}

async function addMany() {
  const group = state.view.type === "group" ? state.view.name : "";
  const text = await ask({
    title: "Ajout en lot",
    text: `Un serveur par ligne : user@hôte:port puis un nom (facultatif).${group ? `\nIls iront dans le groupe « ${group} ».` : ""}`,
    area: "",
    placeholder: "root@10.0.1.12 web-prod-1\nroot@10.0.1.13 web-prod-2\ndeploy@db.example.com:2222 db",
    ok: "Ajouter",
  });
  if (!text?.trim()) return;
  try {
    importReport(await go("Servers.AddMany", text, group), "Ajout en lot");
  } catch (e) {
    toast(errText(e), true);
  }
}
async function importSSHConfig() {
  try {
    importReport(await go("Servers.ImportSSHConfig", state.view.type === "group" ? state.view.name : ""), "~/.ssh/config");
  } catch (e) {
    toast(errText(e), true);
  }
}
async function importFile() {
  try {
    const r = await go("App.Import");
    if (r.added || r.skipped || r.errors.length) importReport(r, "Import");
  } catch (e) {
    toast(errText(e), true);
  }
}
