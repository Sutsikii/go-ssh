"use strict";

// Terminal tabs: xterm.js on an SSH shell. Output streams from Go through
// a channel (base64 bytes), keys go back with Terminals.Write.

const termTheme = {
  background: "#0e0e10",
  foreground: "#e6e6e8",
  cursor: "#efefed",
  cursorAccent: "#0e0e10",
  selectionBackground: "rgba(106, 168, 255, 0.35)",
  black: "#1b1b1f", red: "#ff6b70", green: "#34d399", yellow: "#f5a524",
  blue: "#6aa8ff", magenta: "#b197fc", cyan: "#5ad1e0", white: "#d4d4d8",
  brightBlack: "#5e5e65", brightRed: "#ff8f93", brightGreen: "#6ee7b7", brightYellow: "#fcd34d",
  brightBlue: "#93c5fd", brightMagenta: "#d0bfff", brightCyan: "#99f6e4", brightWhite: "#ffffff",
};

function b64bytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let audio = null;
function beep() {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.06, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.15);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.15);
  } catch {}
}

function newTermTab(serverId) {
  const pane = $("#tpl-term").content.firstElementChild.cloneNode(true);
  const tab = { kind: "term", serverId, pane, sid: null, connected: false, phase: "connecting", channel: null, title: "" };
  const q = (s) => $(s, pane);
  const body = q(".term-body");
  q(".t-find").innerHTML = icons.search;
  q(".t-stats").innerHTML = icons.chart;
  q(".t-reconnect").innerHTML = icons.refresh;

  const term = new Terminal({
    fontFamily: prefs.fontFamily,
    fontSize: prefs.fontSize,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
    theme: termTheme,
    macOptionIsMeta: true,
    rightClickSelectsWord: false,
  });
  const fit = new FitAddon.FitAddon();
  const search = new SearchAddon.SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((e, url) => window.open(url, "_blank")));
  tab.term = term;

  const v = () => serverOf(serverId);
  tab.label = () => tab.title || v()?.name || "Terminal";
  tab.stateClass = () => (tab.phase === "connected" ? "online" : tab.phase === "connecting" ? "connecting" : "offline");

  let opened = false;
  tab.fit = () => {
    if (!pane.isConnected || !pane.classList.contains("on") || !body.clientWidth) return;
    if (!opened) {
      term.open(body);
      opened = true;
    }
    try {
      fit.fit();
    } catch {}
    // A terminal connects once it is first seen, at its size.
    if (!tab.started) tab.connect();
  };
  tab.focus = () => term.focus();
  tab.show = () => {
    requestAnimationFrame(() => {
      tab.fit();
      if (!tab.started) tab.connect();
      term.focus();
    });
  };
  tab.render = () => {
    const s = v();
    if (!s) return;
    q(".dot").className = "dot " + tab.stateClass();
    q(".t-name").textContent = s.name;
    q(".t-addr").textContent = addr(s) + (tab.title ? ` — ${tab.title}` : "");
    q(".t-state").textContent = tab.phase === "connected" ? `${term.cols}×${term.rows}` : "";
  };

  // Resize the remote terminal with the pane.
  let resizeTimer = null;
  const ro = new ResizeObserver(() => {
    tab.fit();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (tab.sid && tab.connected) go("Terminals.Resize", tab.sid, term.cols, term.rows).catch(() => {});
      tab.render();
    }, 80);
  });
  ro.observe(body);

  // --- The connection ---

  function overlay(html) {
    q(".term-overlay")?.remove();
    if (!html) return;
    const o = document.createElement("div");
    o.className = "term-overlay";
    o.innerHTML = html;
    body.append(o);
    return o;
  }

  tab.connect = async () => {
    tab.started = true;
    tab.phase = "connecting";
    tab.connected = false;
    renderTabs();
    tab.render();
    const s = v();
    overlay(`<div class="spinner"></div><b>Connexion à ${esc(s?.name)}…</b><p><code>${esc(s ? addr(s) : "")}</code></p>`);
    tab.fit();
    try {
      tab.sid = await go("Terminals.Open", serverId, term.cols || 120, term.rows || 32);
    } catch (e) {
      tab.failed(e);
      return;
    }
    overlay(null);
    tab.phase = "connected";
    tab.connected = true;
    renderTabs();
    tab.render();
    if (activeTab() === tab) term.focus();
    const ch = window.mygo.channel((b64) => {
      term.write(b64bytes(b64));
      if (activeTab() !== tab && !(state.tiled && tab.pane.classList.contains("on")) && !tab.activity) {
        tab.activity = true;
        renderTabs();
      }
    });
    tab.channel = ch;
    const sid = tab.sid;
    go("Terminals.Stream", sid, ch)
      .then((code) => tab.sid === sid && tab.ended(code))
      .catch((e) => tab.sid === sid && tab.ended(null, e));
  };

  tab.failed = (e) => {
    tab.phase = "failed";
    tab.connected = false;
    renderTabs();
    tab.render();
    const hk = hostKeyOf(e);
    const s = v();
    if (hk) {
      const o = overlay(`<b>${hk.changed ? "La clé du serveur a changé" : "Nouveau serveur"}</b><p>Empreinte <code>${esc(hk.fingerprint)}</code></p><div class="row"><button class="primary" data-a="trust">Vérifier la clé…</button><button data-a="close">Fermer</button></div>`);
      o.onclick = async (ev) => {
        const a = ev.target.closest("button")?.dataset.a;
        if (a === "trust" && (await trustDialog(hk))) tab.connect();
        if (a === "close") closeTab(tab.id);
      };
      return;
    }
    const o = overlay(`<b>Connexion impossible</b><p>${esc(errText(e))}</p><div class="row"><button class="primary" data-a="retry">Réessayer</button><button data-a="edit">Modifier ${esc(s?.name || "")}</button><button data-a="close">Fermer</button></div>`);
    o.onclick = (ev) => {
      const a = ev.target.closest("button")?.dataset.a;
      if (a === "retry") tab.connect();
      if (a === "edit") openEditor(serverId, { thenConnect: true, tab });
      if (a === "close") closeTab(tab.id);
    };
  };

  tab.ended = (code, err) => {
    tab.connected = false;
    tab.phase = "ended";
    tab.sid = null;
    renderTabs();
    tab.render();
    const why = err ? errText(err) : code ? `Le shell a quitté avec le code ${code}.` : "Le shell est terminé.";
    const o = overlay(`<b>Session terminée</b><p>${esc(why)}</p><div class="row"><button class="primary" data-a="re">Reconnecter <kbd>↵</kbd></button><button data-a="close">Fermer l'onglet</button></div>`);
    o.onclick = (ev) => {
      const a = ev.target.closest("button")?.dataset.a;
      if (a === "re") tab.reconnect();
      if (a === "close") closeTab(tab.id);
    };
  };

  tab.reconnect = () => {
    tab.disconnect();
    term.write("\r\n\x1b[2m— reconnexion —\x1b[0m\r\n");
    tab.connect();
  };
  tab.disconnect = () => {
    const sid = tab.sid;
    tab.sid = null;
    tab.connected = false;
    try {
      tab.channel?.close();
    } catch {}
    tab.channel = null;
    if (sid) go("Terminals.Close", sid).catch(() => {});
  };
  tab.destroy = () => {
    tab.disconnect();
    ro.disconnect();
    term.dispose();
  };
  tab.status = (st) => {
    // A connection that came back while this session was over.
    if (st.id === serverId && activeTab() === tab) tab.render();
  };

  // --- Input ---

  const send = (data) => {
    if (!tab.connected) {
      if (data === "\r" && (tab.phase === "ended" || tab.phase === "failed")) tab.reconnect();
      return;
    }
    const targets = state.broadcast ? tabsOf("term").filter((t) => t.connected) : [tab];
    for (const t of targets) go("Terminals.Write", t.sid, data).catch(() => {});
  };
  term.onData(send);
  term.onBinary(send);
  term.onTitleChange((t) => {
    tab.title = t.length > 60 ? t.slice(0, 60) + "…" : t;
    renderTabs();
    tab.render();
  });
  term.onBell(() => prefs.bell && beep());
  term.onSelectionChange(() => {
    if (prefs.copyOnSelect && term.hasSelection()) go("App.WriteClipboard", term.getSelection()).catch(() => {});
  });

  async function paste() {
    const text = await go("App.ReadClipboard");
    if (text) term.paste(text);
  }
  function copy() {
    if (!term.hasSelection()) return false;
    go("App.WriteClipboard", term.getSelection()).catch(() => {});
    term.clearSelection();
    return true;
  }
  tab.copy = copy;
  tab.paste = paste;

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    const k = e.key.toLowerCase();
    // In terminals the app takes only keys shells leave alone.
    if (e.ctrlKey && e.shiftKey && k === "c") return copy(), e.preventDefault(), false;
    if (e.ctrlKey && e.shiftKey && k === "v") return paste(), e.preventDefault(), false;
    if (e.ctrlKey && e.shiftKey && k === "f") return toggleFind(true), e.preventDefault(), false;
    if (e.ctrlKey && e.shiftKey && (k === "k" || k === "t")) return openPalette(), e.preventDefault(), false;
    if (e.ctrlKey && !e.shiftKey && (k === "=" || k === "+" || k === "-" || k === "0")) {
      setFontSize(k === "0" ? 14 : prefs.fontSize + (k === "-" ? -1 : 1));
      e.preventDefault();
      return false;
    }
    if ((e.ctrlKey && (k === "tab" || (/^[1-9]$/.test(e.key) && !e.shiftKey) || k === ",")) || (e.ctrlKey && e.shiftKey && ["w", "m", "b"].includes(k))) {
      if (appShortcut(e)) {
        e.preventDefault();
        return false;
      }
    }
    if (e.key === "Enter" && !tab.connected && tab.phase !== "connecting") {
      tab.reconnect();
      return false;
    }
    return true;
  });
  body.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!copy()) paste();
  });
  body.addEventListener("mousedown", () => {
    if (state.tiled && activeTab() !== tab) activateTab(tab.id);
  });

  // --- Find ---
  const find = q(".term-find");
  const findInput = $("input", find);
  const findOpts = { decorations: { matchOverviewRuler: "#f5a524", activeMatchColorOverviewRuler: "#ff6b70", matchBackground: "#5a4a1a", activeMatchBackground: "#8a5a00" } };
  function toggleFind(on) {
    find.hidden = !on;
    tab.fit();
    if (on) {
      findInput.focus();
      findInput.select();
    } else {
      search.clearDecorations();
      term.focus();
    }
  }
  findInput.oninput = () => search.findNext(findInput.value, { ...findOpts, incremental: true });
  findInput.onkeydown = (e) => {
    if (e.key === "Enter") (e.shiftKey ? search.findPrevious : search.findNext).call(search, findInput.value, findOpts);
    if (e.key === "Escape") toggleFind(false);
  };
  $(".t-find-next", find).onclick = () => search.findNext(findInput.value, findOpts);
  $(".t-find-prev", find).onclick = () => search.findPrevious(findInput.value, findOpts);
  q(".t-find").onclick = () => toggleFind(find.hidden);
  q(".t-stats").onclick = () => openDetail(serverId);
  q(".t-reconnect").onclick = () => tab.reconnect();

  return tab;
}

function setFontSize(n) {
  prefs.fontSize = Math.min(28, Math.max(9, n));
  savePrefs();
  applyTermPrefs();
}
function applyTermPrefs() {
  for (const t of tabsOf("term")) {
    t.term.options.fontSize = prefs.fontSize;
    t.term.options.fontFamily = prefs.fontFamily;
    t.fit();
  }
}
