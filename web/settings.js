"use strict";

// --- Server editor ----------------------------------------------------------

let editing = null; // { id, color, opts }

function openEditor(id, opts = {}) {
  const v = id ? serverOf(id) : null;
  editing = { id: v?.id || "", color: v?.color || "", opts };
  const f = $("#editor-form");
  $("#editor-title").textContent = v ? `Modifier ${v.name}` : "Nouveau serveur";
  f.name.value = v?.name || "";
  f.host.value = v?.host || "";
  f.user.value = v?.user || "";
  f.port.value = v?.port && v.port !== 22 ? v.port : "";
  f.keyPath.value = v?.keyPath || "";
  f.password.value = "";
  f.password.placeholder = v?.hasPassword ? "•••••• (enregistré, vide pour garder)" : "Facultatif";
  f.passphrase.value = "";
  f.passphrase.placeholder = v?.hasPassphrase ? "•••••• (enregistrée)" : "Si la clé est protégée";
  f.group.value = v ? v.group || "" : state.view.type === "group" ? state.view.name : "";
  f.tags.value = (v?.tags || []).join(", ");
  f.notes.value = v?.notes || "";
  f.monitor.checked = v ? v.monitor : true;
  f.jumpId.innerHTML = `<option value="">Aucun (connexion directe)</option>` + state.servers.filter((s) => s.id !== v?.id).map((s) => `<option value="${s.id}">${esc(s.name)} — ${esc(addr(s))}</option>`).join("");
  f.jumpId.value = v?.jumpId || "";
  renderColors();
  const msg = $("#editor-msg");
  msg.hidden = true;
  $("#editor").hidden = false;
  setTimeout(() => (v ? f.name : f.host).focus(), 30);
}

function renderColors() {
  $("#editor-colors").innerHTML =
    `<button type="button" class="none ${editing.color ? "" : "on"}" data-c="" title="Aucune">${icons.close}</button>` +
    colors.map((c) => `<button type="button" class="${editing.color === c ? "on" : ""}" data-c="${c}" style="background:${c}"></button>`).join("");
}

function editorInput() {
  const f = $("#editor-form");
  const old = editing.id ? serverOf(editing.id) : null;
  return {
    ...(old || {}),
    id: editing.id,
    name: f.name.value,
    host: f.host.value.trim().replace(/^ssh:\/\//, ""),
    user: f.user.value,
    port: +f.port.value || 22,
    keyPath: f.keyPath.value,
    group: f.group.value,
    jumpId: f.jumpId.value,
    tags: f.tags.value.split(",").map((t) => t.trim()).filter(Boolean),
    notes: f.notes.value,
    color: editing.color,
    monitor: f.monitor.checked,
    favorite: old?.favorite || false,
    password: f.password.value ? f.password.value : null,
    passphrase: f.passphrase.value ? f.passphrase.value : null,
  };
}

// saveEditor saves the form and returns the server's ID.
async function saveEditor() {
  const input = editorInput();
  // "user@host:port" typed into the address.
  const m = /^(?:([^@\s]+)@)?([^:\s]+)(?::(\d+))?$/.exec(input.host);
  if (m) {
    if (m[1] && !input.user) input.user = m[1];
    input.host = m[2];
    if (m[3]) input.port = +m[3];
  }
  const before = new Set(state.servers.map((s) => s.id));
  const inv = await go("Servers.Save", input);
  applyInventory(inv);
  const id = editing.id || inv.servers.find((s) => !before.has(s.id))?.id;
  editing.id = id;
  return id;
}

function initEditor() {
  const f = $("#editor-form");
  $("#editor-colors").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    editing.color = b.dataset.c;
    renderColors();
  };
  $("#editor-key").onclick = async () => {
    const p = await go("App.ChooseKey");
    if (p) f.keyPath.value = p;
  };
  const close = () => {
    $("#editor").hidden = true;
    editing = null;
    activeTab()?.focus?.();
  };
  $("#editor-cancel").onclick = close;
  $("#editor").onkeydown = (e) => e.key === "Escape" && close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const opts = editing.opts;
    try {
      const id = await saveEditor();
      close();
      if (opts.thenConnect) {
        if (opts.tab && state.tabs.includes(opts.tab)) {
          activateTab(opts.tab.id);
          opts.tab.reconnect();
        } else openTerminal(id);
      }
    } catch (err) {
      showMsg(errText(err), "err");
    }
  };
  $("#editor-test").onclick = async () => {
    showMsg("Connexion…", "");
    try {
      const id = await saveEditor();
      $("#editor-title").textContent = `Modifier ${serverOf(id)?.name}`;
      const ms = await go("Monitor.Test", id);
      showMsg(`Connexion réussie en ${ms} ms. Les modifications sont enregistrées.`, "ok");
    } catch (err) {
      const hk = hostKeyOf(err);
      if (hk) {
        showMsg("Clé du serveur à vérifier…", "");
        if (await trustDialog(hk)) $("#editor-test").click();
        else showMsg("Clé non approuvée.", "err");
        return;
      }
      showMsg(errText(err), "err");
    }
  };
}

function showMsg(text, cls) {
  const msg = $("#editor-msg");
  msg.hidden = false;
  msg.className = "small " + cls;
  msg.textContent = text;
}

// --- Settings ---------------------------------------------------------------

const themes = [
  { value: "system", label: "Système", mock: '<span class="mock"><i class="m-side"></i><i class="m-card"><i></i><i></i><i class="m-btn"></i></i></span><span class="mock mock-dark"><i class="m-side"></i><i class="m-card"><i></i><i></i><i class="m-btn"></i></i></span>' },
  { value: "light", label: "Clair", mock: '<span class="mock"><i class="m-side"></i><i class="m-card"><i></i><i></i><i class="m-btn"></i></i></span>' },
  { value: "dark", label: "Sombre", mock: '<span class="mock mock-dark"><i class="m-side"></i><i class="m-card"><i></i><i></i><i class="m-btn"></i></i></span>' },
];

function newSettingsTab() {
  const pane = $("#tpl-settings").content.firstElementChild.cloneNode(true);
  const tab = { kind: "settings", pane };
  const q = (s) => $(s, pane);
  tab.label = () => "Paramètres";

  q(".themes").onchange = async (e) => {
    try {
      state.settings.settings = await go("App.SetTheme", e.target.value);
    } catch (err) {
      toast(errText(err), true);
    }
  };
  q(".s-font").oninput = (e) => {
    setFontSize(+e.target.value);
    q(".s-font-v").textContent = prefs.fontSize + " px";
  };
  q(".s-family").onchange = (e) => {
    prefs.fontFamily = e.target.value;
    savePrefs();
    applyTermPrefs();
  };
  q(".s-copy").onchange = (e) => {
    prefs.copyOnSelect = e.target.checked;
    savePrefs();
  };
  q(".s-bell").onchange = (e) => {
    prefs.bell = e.target.checked;
    savePrefs();
  };
  q(".s-interval").onchange = async (e) => {
    try {
      state.settings.settings = await go("App.SetInterval", +e.target.value);
      toast(`Statistiques toutes les ${state.settings.settings.interval} s`);
    } catch (err) {
      toast(errText(err), true);
      e.target.value = state.settings.settings.interval;
    }
  };
  q(".s-export").onclick = async () => {
    try {
      const p = await go("App.Export");
      if (p) toast("Exporté : " + p);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  q(".s-import").onclick = () => importFile();
  q(".s-sshconfig").onclick = () => importSSHConfig();
  q(".s-open").onclick = () => go("App.OpenDataDir");

  tab.render = async () => {
    const info = state.settings;
    if (!info) return;
    q(".themes").innerHTML = themes
      .map((t) => `<label class="theme-choice"><input type="radio" name="theme" value="${t.value}" ${info.settings.theme === t.value ? "checked" : ""} /><span class="theme-preview">${t.mock}</span><b>${t.label}</b></label>`)
      .join("");
    q(".s-font").value = prefs.fontSize;
    q(".s-font-v").textContent = prefs.fontSize + " px";
    q(".s-family").value = prefs.fontFamily;
    q(".s-copy").checked = prefs.copyOnSelect;
    q(".s-bell").checked = prefs.bell;
    if (document.activeElement !== q(".s-interval")) q(".s-interval").value = info.settings.interval;
    q(".s-dir").textContent = info.dataDir;
    q(".s-version").textContent = info.version;
    q(".s-secret-note").textContent =
      info.platform === "windows"
        ? "Les mots de passe sont chiffrés avec DPAPI : seul ce compte Windows, sur ce PC, peut les relire."
        : "Les mots de passe sont dans servers.json, lisible par ce seul utilisateur. Préférer les clés et l'agent SSH.";
    const known = await go("Monitor.KnownHosts");
    q(".s-known").innerHTML = known.length
      ? `<div class="known">${known.map((k) => `<div><b>${esc(k.hosts)}</b><span>${esc(k.type)} ${esc(k.fingerprint)}</span></div>`).join("")}</div>`
      : `<p class="muted">Aucune pour l'instant. Les clés de ~/.ssh/known_hosts sont aussi reconnues.</p>`;
  };
  return tab;
}
