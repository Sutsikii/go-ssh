"use strict";

// Bulk commands: one command on many servers at once, their outputs side by
// side.

const presets = [
  { label: "uptime", cmd: "uptime" },
  { label: "Espace disque", cmd: "df -h -x tmpfs -x devtmpfs -x overlay -x squashfs" },
  { label: "Mémoire", cmd: "free -h" },
  { label: "Système", cmd: '. /etc/os-release; echo "$PRETTY_NAME · $(uname -r)"' },
  { label: "Mises à jour (apt)", cmd: "apt list --upgradable 2>/dev/null | tail -n +2 | wc -l" },
  { label: "Services en échec", cmd: "systemctl --failed --no-legend" },
  { label: "Docker", cmd: "docker ps --format 'table {{.Names}}\\t{{.Status}}'" },
  { label: "Top CPU", cmd: "ps -eo pid,comm,%cpu,%mem --sort=-%cpu | head -6" },
  { label: "Redémarrage requis", cmd: "[ -f /var/run/reboot-required ] && echo oui || echo non" },
];

function newBulkTab() {
  const pane = $("#tpl-bulk").content.firstElementChild.cloneNode(true);
  const tab = { kind: "bulk", pane, picked: new Set(), results: new Map(), order: [], running: null, filter: "", groupFilter: "*", resultFilter: "", collapsed: new Set() };
  const q = (s) => $(s, pane);
  tab.label = () => "Commandes" + (tab.running ? " ⋯" : "");

  tab.select = (ids) => {
    tab.picked = new Set(ids);
    tab.render();
  };

  q(".b-presets").innerHTML =
    presets.map((p, i) => `<button data-i="${i}" title="${esc(p.cmd)}">${esc(p.label)}</button>`).join("") +
    `<button data-act="key" title="Ajouter une clé publique à ~/.ssh/authorized_keys">${icons.key} Copier ma clé</button>`;
  q(".b-presets").onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.act === "key") return pickKey(b);
    q(".b-cmd").value = presets[+b.dataset.i].cmd;
    q(".b-cmd").focus();
  };
  async function pickKey(b) {
    const keys = await go("App.PublicKeys");
    if (!keys.length) return toast("Aucune clé publique dans ~/.ssh (ssh-keygen -t ed25519)", true);
    menuAt(b, [
      { header: "Clé à autoriser" },
      ...keys.map((k) => ({
        label: k.name,
        icon: icons.key,
        run: () => {
          // Idempotent: the key is added once.
          const line = k.line.replace(/'/g, "'\\''");
          q(".b-cmd").value = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && (grep -qxF '${line}' ~/.ssh/authorized_keys && echo "déjà présente" || (echo '${line}' >> ~/.ssh/authorized_keys && echo "clé ajoutée"))`;
        },
      })),
    ]);
  }

  q(".b-filter").oninput = (e) => {
    tab.filter = e.target.value.toLowerCase();
    renderTargets();
  };
  q(".b-group").onchange = (e) => {
    tab.groupFilter = e.target.value;
    renderTargets();
  };
  const shown = () =>
    state.servers.filter((v) => {
      if (tab.groupFilter === "" && v.group) return false;
      if (tab.groupFilter !== "*" && tab.groupFilter !== "" && v.group !== tab.groupFilter) return false;
      const hay = [v.name, v.host, v.user, v.group, ...(v.tags || [])].join(" ").toLowerCase();
      return !tab.filter || tab.filter.split(/\s+/).every((w) => hay.includes(w));
    });
  q(".b-all").onclick = () => {
    for (const v of shown()) tab.picked.add(v.id);
    tab.render();
  };
  q(".b-none").onclick = () => {
    for (const v of shown()) tab.picked.delete(v.id);
    tab.render();
  };
  q(".b-targets").onchange = (e) => {
    const id = e.target.closest("[data-id]")?.dataset.id;
    if (!id) return;
    if (e.target.checked) tab.picked.add(id);
    else tab.picked.delete(id);
    renderCount();
  };

  function renderTargets() {
    const list = shown();
    q(".b-targets").innerHTML = list.length
      ? list.map((v) => `<label class="b-target" data-id="${v.id}"><input type="checkbox" ${tab.picked.has(v.id) ? "checked" : ""} /><i class="dot ${stateOf(v.id)}"></i><span>${esc(v.name)}</span><span class="addr">${esc(addr(v))}</span></label>`).join("")
      : `<div class="muted small" style="padding:10px">Aucun serveur.</div>`;
    renderCount();
  }
  function renderCount() {
    for (const id of tab.picked) if (!serverOf(id)) tab.picked.delete(id);
    const n = tab.picked.size;
    const down = [...tab.picked].filter(isDown).length;
    q(".b-count").textContent = `· ${n} sélectionné${n > 1 ? "s" : ""}${down ? ` (${down} hors ligne)` : ""}`;
    q(".b-run").disabled = !n || !!tab.running;
  }

  tab.render = () => {
    const sel = q(".b-group");
    const cur = tab.groupFilter;
    sel.innerHTML = `<option value="*">Tous</option>${state.groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join("")}${state.groups.length ? `<option value="">Sans groupe</option>` : ""}`;
    sel.value = cur;
    if (sel.value !== cur) tab.groupFilter = sel.value = "*";
    renderTargets();
    renderResults();
  };
  tab.status = () => {
    if (activeTab() === tab) renderTargets();
  };

  // --- Running ---

  q(".b-cmd").onkeydown = (e) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      run();
    }
  };
  q(".b-run").onclick = () => run();
  q(".b-stop").onclick = () => tab.running?.close();

  async function run() {
    const cmd = q(".b-cmd").value.trim();
    const ids = state.servers.filter((v) => tab.picked.has(v.id)).map((v) => v.id);
    if (!cmd || !ids.length || tab.running) return;
    if (/\b(reboot|shutdown|poweroff|halt|rm\s+-rf\s+\/(\s|$)|mkfs)\b/.test(cmd)) {
      const ok = await ask({ title: "Commande sensible", html: `Lancer sur <b>${ids.length}</b> serveur${ids.length > 1 ? "s" : ""} :\n\n<code>${esc(cmd)}</code>`, ok: "Lancer", danger: true });
      if (!ok) return;
    }
    tab.results = new Map(ids.map((id) => [id, { id, state: "wait", out: "", code: null, error: "", ms: 0 }]));
    tab.order = ids;
    tab.command = cmd;
    tab.resultFilter = "";
    tab.collapsed = new Set();
    const ch = window.mygo.channel((e) => {
      const r = tab.results.get(e.serverId);
      if (!r) return;
      if (e.kind === "start") r.state = "run";
      if (e.kind === "output") r.out += e.data;
      if (e.kind === "done") {
        r.state = e.error ? "fail" : e.code === 0 ? "ok" : "err";
        r.code = e.code;
        r.error = e.error || "";
        r.ms = e.millis;
      }
      scheduleResults(e.serverId);
    });
    tab.running = ch;
    q(".b-stop").hidden = false;
    renderCount();
    renderTabs();
    renderResults();
    const parallel = Math.max(1, Math.min(64, +q(".b-parallel").value || 16));
    try {
      await go("Bulk.Run", ids, cmd, parallel, ch);
    } catch (e) {
      toast(errText(e), true);
    }
    tab.running = null;
    for (const r of tab.results.values()) if (r.state === "wait" || r.state === "run") (r.state = "fail"), (r.error = "arrêté");
    q(".b-stop").hidden = true;
    renderCount();
    renderTabs();
    renderResults();
    const bad = [...tab.results.values()].filter((r) => r.state !== "ok").length;
    if (activeTab() !== tab) toast(`Commande terminée : ${ids.length - bad} OK, ${bad} en échec`, bad > 0);
  }

  // Outputs redraw by server, a few times a second.
  const dirty = new Set();
  let timer = null;
  function scheduleResults(id) {
    dirty.add(id);
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const ids = [...dirty];
      dirty.clear();
      renderSummary();
      for (const id of ids) {
        const el = $(`.b-result[data-id="${id}"]`, pane);
        if (el && matchesFilter(tab.results.get(id))) el.replaceWith(resultEl(tab.results.get(id)));
        else renderResults();
      }
    }, 150);
  }

  const matchesFilter = (r) => !tab.resultFilter || (tab.resultFilter === "ok" ? r.state === "ok" : tab.resultFilter === "bad" ? r.state === "err" || r.state === "fail" : r.state === "run" || r.state === "wait");

  function resultEl(r) {
    const v = serverOf(r.id);
    const div = document.createElement("div");
    div.className = "b-result" + (tab.collapsed?.has(r.id) ? " collapsed" : "");
    div.dataset.id = r.id;
    const right =
      r.state === "wait" ? `<span class="muted">en attente</span>`
      : r.state === "run" ? `<i class="mini-spin"></i>`
      : `<span class="muted">${r.ms < 1000 ? r.ms + " ms" : (r.ms / 1000).toFixed(1) + " s"}</span><span class="code ${r.state === "ok" ? "ok" : "err"}">${r.state === "fail" ? "erreur" : "code " + r.code}</span>`;
    div.innerHTML = `<div class="b-result-head"><i class="dot ${r.state === "ok" ? "online" : r.state === "err" || r.state === "fail" ? "offline" : "connecting"}"></i><b>${esc(v?.name || r.id)}</b><span class="muted">${esc(v ? addr(v) : "")}</span><span class="right">${right}</span></div><pre></pre>${r.error ? `<div class="err-text">${esc(r.error)}</div>` : ""}`;
    $("pre", div).textContent = r.out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    const pre = $("pre", div);
    requestAnimationFrame(() => (pre.scrollTop = pre.scrollHeight));
    return div;
  }

  function renderSummary() {
    const el = q(".b-summary");
    if (!tab.results.size) {
      el.innerHTML = "";
      return;
    }
    const all = [...tab.results.values()];
    const n = (f) => all.filter(f).length;
    const ok = n((r) => r.state === "ok"), bad = n((r) => r.state === "err" || r.state === "fail"), run = n((r) => r.state === "run" || r.state === "wait");
    const chip = (f, label, cls) => `<button class="chip ${tab.resultFilter === f ? "on" : ""}" data-f="${f}">${cls ? `<i class="dot ${cls}"></i>` : ""}${label}</button>`;
    el.innerHTML =
      chip("", `Tous ${all.length}`) + chip("ok", `${ok} OK`, "online") + chip("bad", `${bad} en échec`, "offline") + (run ? chip("run", `${run} en cours`, "connecting") : "") +
      `<code class="mono muted" style="margin-left:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40%">$ ${esc(tab.command)}</code>` +
      `<div class="tools"><button class="ghost" data-t="fold">Tout replier</button><button class="ghost" data-t="copy">${icons.copy}Copier</button>${bad && !tab.running ? `<button data-t="retry">Relancer les échecs</button>` : ""}</div>`;
  }
  q(".b-summary").onclick = (e) => {
    const f = e.target.closest("[data-f]");
    if (f) {
      tab.resultFilter = f.dataset.f;
      renderResults();
    }
    const t = e.target.closest("[data-t]")?.dataset.t;
    if (t === "copy") {
      const text = tab.order.map((id) => tab.results.get(id)).filter(matchesFilter).map((r) => `### ${serverOf(r.id)?.name} (${r.state === "fail" ? r.error : "code " + r.code})\n${r.out}`).join("\n");
      copyText(text);
    }
    if (t === "fold") {
      const all = tab.collapsed.size < tab.order.length;
      tab.collapsed = new Set(all ? tab.order : []);
      renderResults();
    }
    if (t === "retry") {
      tab.picked = new Set(tab.order.filter((id) => ["err", "fail"].includes(tab.results.get(id).state)));
      tab.render();
      run();
    }
  };
  q(".b-results").onclick = (e) => {
    const head = e.target.closest(".b-result-head");
    if (!head) return;
    const id = head.parentElement.dataset.id;
    if (tab.collapsed.has(id)) tab.collapsed.delete(id);
    else tab.collapsed.add(id);
    head.parentElement.classList.toggle("collapsed");
  };
  q(".b-results").ondblclick = (e) => {
    const id = e.target.closest(".b-result-head")?.parentElement.dataset.id;
    if (id) openTerminal(id);
  };

  function renderResults() {
    renderSummary();
    const el = q(".b-results");
    if (!tab.results.size) {
      el.innerHTML = `<div class="b-empty"><b>Prêt</b>Choisir des serveurs, écrire une commande,<br>puis <kbd>Ctrl ↵</kbd>. Les sorties s'affichent ici, serveur par serveur.</div>`;
      return;
    }
    el.replaceChildren(...tab.order.map((id) => tab.results.get(id)).filter(matchesFilter).map(resultEl));
  }

  tab.focus = () => q(".b-cmd").focus();
  tab.show = () => requestAnimationFrame(() => q(".b-cmd").focus());
  tab.destroy = () => tab.running?.close();
  return tab;
}
