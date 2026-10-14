"use strict";

// A server's statistics: live charts of its history, its system, disks,
// network and its group's other servers.

function newDetailTab(serverId) {
  const pane = $("#tpl-detail").content.firstElementChild.cloneNode(true);
  const tab = { kind: "detail", serverId, pane, hist: [], range: 3600, loaded: false };
  const q = (s) => $(s, pane);
  tab.label = () => serverOf(serverId)?.name ?? "Serveur";

  q(".host-icon").insertAdjacentHTML("afterbegin", icons.server);
  q(".range").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    tab.range = +b.dataset.range;
    $$("button", q(".range")).forEach((x) => x.classList.toggle("on", x === b));
    tab.drawCharts();
  };
  q(".crumbs").onclick = (e) => {
    if (e.target.closest("a")) openHome();
  };

  const charts = [
    {
      key: "cpu", title: "CPU", icon: icons.cpu, max: () => 100, fmt: (v) => `${Math.round(v)}%`,
      series: [
        { label: "total", color: "var(--c1)", get: (s) => s.cpu },
        { label: "user", color: "var(--c2)", get: (s) => s.user },
        { label: "system", color: "var(--c3)", get: (s) => s.system },
      ],
    },
    {
      key: "mem", title: "Mémoire", icon: icons.memory, fmt: (v) => sizeText(v, 1),
      max: (h) => Math.max(...h.map((s) => s.memTotal), 1),
      value: (s) => `${sizeText(s.memUsed, 1)} / ${sizeText(s.memTotal)}`,
      series: [
        { label: "utilisée", color: "var(--c1)", get: (s) => s.memUsed, fill: true },
        { label: "swap", color: "var(--c3)", get: (s) => s.swapUsed, hideIfZero: true },
      ],
    },
    {
      key: "load", title: "Charge", icon: icons.gauge, fmt: (v) => v.toFixed(2),
      series: [
        { label: "1m", color: "var(--c2)", get: (s) => s.load1 },
        { label: "5m", color: "var(--c3)", get: (s) => s.load5 },
        { label: "15m", color: "var(--c1)", get: (s) => s.load15 },
      ],
    },
    {
      key: "net", title: "Réseau", icon: icons.globe, fmt: rateText,
      series: [
        { label: "reçu", color: "var(--c4)", get: (s) => s.rx, fill: true },
        { label: "envoyé", color: "var(--c1)", get: (s) => s.tx },
      ],
    },
    {
      key: "io", title: "Disque E/S", icon: icons.disk, fmt: ioText, wide: true,
      series: [
        { label: "lecture", color: "var(--c2)", get: (s) => s.read, fill: true },
        { label: "écriture", color: "var(--c3)", get: (s) => s.write },
      ],
    },
  ];
  q(".charts").innerHTML = charts
    .map((c) => `<section class="chart-card ${c.wide ? "wide" : ""}" data-chart="${c.key}"><div class="chart-head">${c.icon}<h3>${c.title}</h3><div class="legend"></div></div><div class="chart"></div></section>`)
    .join("");

  tab.load = async () => {
    tab.hist = await go("Monitor.History", serverId);
    tab.loaded = true;
    tab.render();
  };

  tab.drawCharts = () => {
    const now = Date.now();
    const h = tab.hist.filter((s) => s.t >= now - tab.range * 1000);
    const live = isUp(serverId);
    for (const c of charts) {
      const card = $(`[data-chart="${c.key}"]`, pane);
      const last = h.at(-1);
      const series = c.series.filter((s) => !s.hideIfZero || h.some((x) => s.get(x) > 0));
      $(".legend", card).innerHTML = c.value && last
        ? `<span><b>${esc(c.value(last))}</b></span>`
        : series.map((s) => `<span><i style="background:${s.color}"></i>${s.label}${last && live ? ` <b>${c.fmt(s.get(last))}</b>` : ""}</span>`).join("");
      lineChart($(".chart", card), h, series, { max: c.max?.(h), fmt: c.fmt, from: now - tab.range * 1000, to: now });
    }
  };

  tab.render = () => {
    const v = serverOf(serverId);
    if (!v) return;
    if (!tab.loaded) tab.load();
    const st = statusOf(serverId);
    const s = stateOf(serverId);
    q(".crumbs").innerHTML = `${icons.server}<a>Serveurs</a><span>/</span>${v.group ? `<span>${esc(v.group)}</span><span>/</span>` : ""}<b>${esc(v.name)}</b>`;
    q(".host-icon .dot").className = "dot " + s;
    q(".d-name").textContent = v.name;
    const info = st?.info;
    q(".d-sub").textContent = info ? [info.os, info.arch, info.cpus ? `${info.cpus} vCPU` : "", info.hostname !== v.name ? info.hostname : ""].filter(Boolean).join(" · ") : addr(v);
    q(".d-seen").textContent = st?.lastSeen ? `vu ${agoText(st.lastSeen)}` : "";
    q(".live-pill").classList.toggle("on", s === "online");
    $("span", q(".live-pill")).textContent = s === "online" ? "Live" : stateLabels[s];

    const alert = q(".d-alert");
    alert.hidden = s === "online" && st?.linux !== false;
    alert.classList.toggle("dim", s === "off" || s === "connecting" || (s === "online" && !st?.linux));
    if (s === "hostkey") {
      alert.innerHTML = `${icons.key}<span>${st.hostKey?.changed ? "La clé du serveur a changé depuis la dernière connexion." : "Première connexion : vérifier l'empreinte du serveur."}</span><button class="primary">Vérifier la clé</button>`;
      $("button", alert).onclick = () => trustDialog(st.hostKey);
    } else if (s === "offline") {
      alert.innerHTML = `${icons.unlink}<span>${esc(st?.error || "Injoignable")}</span><button>Réessayer</button>`;
      $("button", alert).onclick = () => go("Monitor.Refresh", [serverId]);
    } else if (s === "off") {
      alert.innerHTML = `${icons.chart}<span>Les statistiques de ce serveur ne sont pas relevées.</span><button>Activer</button>`;
      $("button", alert).onclick = () => go("Servers.SetMonitor", [serverId], true).then(applyInventory);
    } else if (s === "connecting") alert.innerHTML = `<span>Connexion…</span>`;
    else alert.innerHTML = `<span>${esc(st?.error || "")}</span>`;

    tab.drawCharts();
    renderSide(q(".detail-side"), v, st, s);
  };

  tab.status = (st) => {
    if (st.id !== serverId) {
      if (activeTab() === tab && serverOf(st.id)?.group === serverOf(serverId)?.group) renderSide(q(".detail-side"), serverOf(serverId), statusOf(serverId), stateOf(serverId));
      return;
    }
    if (st.latest && st.state === "online" && tab.loaded && (!tab.hist.length || st.latest.t > tab.hist.at(-1).t) && st.latest.memTotal) {
      // The first sample after a connection has no rates: skip it, as Go does.
      if (st.latest.cpu || st.latest.rx || st.latest.read || tab.hist.length) tab.hist.push(st.latest);
      if (tab.hist.length > 720) tab.hist.shift();
    }
    if (activeTab() === tab) tab.render();
  };

  // Redraw the charts' time axis every few seconds.
  const tick = setInterval(() => {
    if (activeTab() === tab) {
      tab.drawCharts();
      const st = statusOf(serverId);
      q(".d-seen").textContent = st?.lastSeen ? `vu ${agoText(st.lastSeen)}` : "";
    }
  }, 5000);
  tab.destroy = () => clearInterval(tick);
  return tab;
}

function renderSide(el, v, st, s) {
  const info = st?.info;
  const l = s === "online" ? st?.latest : null;
  const kv = (rows) => `<div class="kv">${rows.filter(Boolean).map(([k, val]) => `<div><span class="k">${k}</span><span class="v">${val}</span></div>`).join("")}</div>`;
  const jump = v.jumpId ? serverOf(v.jumpId) : null;
  let html = `<div class="side-actions">
      <button class="primary" data-act="term">${icons.terminal}Ouvrir un terminal</button>
      <button data-act="edit">${icons.edit}Modifier</button>
      <button data-act="more">${icons.more}Plus</button>
    </div>
    <div class="status-row"><span class="state-pill ${s}"><i class="dot ${s}"></i>${stateLabels[s]}</span>${l ? `<span class="muted mono">up ${durationText(st.uptime)}</span>` : ""}</div>`;
  if (v.group || v.tags?.length) html += `<div class="settings-row">${v.group ? `<span class="tag">${icons.folder} ${esc(v.group)}</span>` : ""}${(v.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>`;

  if (info) {
    html += `<div class="side-h">Système</div>` + kv([
      ["hostname", esc(info.hostname)],
      ["os", esc(info.os)],
      ["kernel", esc(info.kernel)],
      ["arch", esc(info.arch)],
      info.cpu || info.cpus ? ["cpu", `${esc(info.cpu || "?")}${info.cpus ? ` <span class="dim">· ${info.cpus} vCPU</span>` : ""}`] : null,
      l ? ["mémoire", `${sizeText(l.memTotal)}${l.swapTotal ? ` <span class="dim">· swap ${sizeText(l.swapTotal)}</span>` : ""}`] : null,
      l ? ["boot", `${new Date(Date.now() - st.uptime * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} <span class="dim">// ${durationText(st.uptime)}</span>`] : null,
    ]);
  }
  if (st?.disks?.length && s === "online") {
    html += `<div class="side-h">Disques <i>${st.disks.length}</i></div><div class="disks">` +
      st.disks
        .map((d) => {
          const p = pct(d.used, d.total);
          return `<div class="disk"><div class="disk-top"><span>${esc(d.mount)}</span>${d.fs ? `<span class="fs">${esc(d.fs)}</span>` : ""}<span class="num">${sizeText(d.used, 1)} / ${sizeText(d.total)} · ${pctText(p)}</span></div>${bar(p)}</div>`;
        })
        .join("") +
      `</div>`;
  }
  if (l || info?.ips?.length) {
    html += `<div class="side-h">Réseau</div>` + kv([
      l ? [esc(st.ifaces?.length === 1 ? st.ifaces[0] : "trafic"), `<span class="rx">↓ ${rateText(l.rx)}</span> <span class="tx">↑ ${rateText(l.tx)}</span>`] : null,
      info?.ips?.length ? ["ip", esc(info.ips.slice(0, 3).join(", "))] : null,
    ]);
  }
  html += `<div class="side-h">Connexion</div>` + kv([
    ["adresse", esc(addr(v))],
    ["auth", [v.keyPath ? `clé ${esc(v.keyPath.split(/[\\/]/).pop())}` : "clés ~/.ssh + agent", v.hasPassword ? "mot de passe" : ""].filter(Boolean).join(" · ")],
    jump ? ["rebond", esc(jump.name)] : null,
    st?.latency && s === "online" ? ["latence", `${st.latency} ms <span class="dim">// relevé toutes les ${state.settings?.settings.interval ?? 5} s</span>`] : null,
    ["dernière", v.lastUsed ? agoText(v.lastUsed) : "jamais"],
  ]);
  if (v.notes) html += `<div class="side-h">Notes</div><div class="side-notes">${esc(v.notes)}</div>`;

  // The group's other servers, as in a fleet view.
  const peers = v.group ? state.servers.filter((x) => x.group === v.group) : [];
  if (peers.length > 1) {
    html += `<div class="side-h">${esc(v.group)} <i>${peers.length}</i><span class="right">CPU</span></div><div class="peers">` +
      peers
        .slice(0, 30)
        .map((p) => {
          const pl = isUp(p.id) ? statusOf(p.id)?.latest : null;
          return `<div class="peer ${p.id === v.id ? "me" : ""}" data-id="${p.id}"><i class="dot ${stateOf(p.id)}"></i><span>${esc(p.name)}</span><em>${pl ? pctText(pl.cpu) : "–"}</em>${bar(pl ? pl.cpu : 0, "x")}</div>`;
        })
        .join("") +
      `</div>`;
  }
  el.innerHTML = html;
  el.onclick = (e) => {
    const act = e.target.closest("button[data-act]");
    if (act?.dataset.act === "term") openTerminal(v.id);
    if (act?.dataset.act === "edit") openEditor(v.id);
    if (act?.dataset.act === "more") menuAt(act, serverMenu([v.id]));
    const peer = e.target.closest(".peer");
    if (peer && peer.dataset.id !== v.id) openDetail(peer.dataset.id);
  };
}

// --- Charts -----------------------------------------------------------------

// lineChart draws series of samples h into el, as an SVG sized to it, with
// a tooltip on hover. opts: max, fmt, from, to (milliseconds).
function lineChart(el, h, series, opts) {
  const W = Math.max(el.clientWidth, 200), H = Math.max(el.clientHeight, 120);
  const padL = 58, padR = 8, padT = 8, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const from = opts.from, to = opts.to;
  let max = opts.max;
  if (!max) {
    max = 0;
    for (const s of h) for (const se of series) max = Math.max(max, se.get(s));
    max = niceMax(max);
  }
  const x = (t) => padL + ((t - from) / (to - from)) * iw;
  const y = (v) => padT + ih - (Math.min(v, max) / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  let out = ticks
    .map((f) => `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="axis" x="${padL - 8}" y="${y(max * f) + 3.5}" text-anchor="end">${opts.fmt(max * f)}</text>`)
    .join("");
  const span = to - from;
  const step = span <= 300e3 ? 60e3 : span <= 900e3 ? 180e3 : 600e3;
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
    const tx = x(t);
    if (tx < padL + 18 || tx > W - padR - 18) continue;
    out += `<text class="axis" x="${tx}" y="${H - 5}" text-anchor="middle">${new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</text>`;
  }
  if (h.length < 2) {
    out += `<text class="nodata" x="${padL + iw / 2}" y="${padT + ih / 2}" text-anchor="middle">${h.length ? "Premier relevé…" : "Pas encore de données"}</text>`;
  } else {
    // The first series, the main one, is drawn last, on top.
    [...series].reverse().forEach((se, ri) => {
      const i = series.length - 1 - ri;
      // A gap of more than 3 intervals breaks the line.
      let d = "";
      let prev = null;
      const gap = Math.max(30e3, ((h.at(-1).t - h[0].t) / h.length) * 4);
      for (const s of h) {
        const cmd = prev && s.t - prev.t <= gap ? "L" : "M";
        d += `${cmd}${x(s.t).toFixed(1)},${y(se.get(s)).toFixed(1)}`;
        prev = s;
      }
      if (se.fill) {
        const id = `g${Math.random().toString(36).slice(2, 8)}`;
        out += `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${se.color}" stop-opacity=".25"/><stop offset="1" stop-color="${se.color}" stop-opacity="0"/></linearGradient></defs>`;
        out += `<path d="${d} L${x(h.at(-1).t).toFixed(1)},${y(0)} L${x(h[0].t).toFixed(1)},${y(0)} Z" fill="url(#${id})" stroke="none"/>`;
      }
      out += `<path class="series" d="${d}" stroke="${se.color}" style="opacity:${1 - i * 0.08}"/>`;
    });
  }
  out += `<line class="cursor" y1="${padT}" y2="${padT + ih}" x1="-10" x2="-10"/><g class="marks"></g>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${out}</svg><div class="tip" hidden></div>`;
  if (h.length < 2) return;
  const svgEl = $("svg", el), cursor = $(".cursor", el), marks = $(".marks", el), tip = $(".tip", el);
  svgEl.onmousemove = (e) => {
    const r = svgEl.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * W;
    const t = from + ((mx - padL) / iw) * (to - from);
    let best = h[0];
    for (const s of h) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
    const bx = x(best.t);
    cursor.setAttribute("x1", bx);
    cursor.setAttribute("x2", bx);
    marks.innerHTML = series.map((se) => `<circle cx="${bx}" cy="${y(se.get(best))}" r="3.5" fill="var(--panel)" stroke="${se.color}" stroke-width="1.8"/>`).join("");
    const time = new Date(best.t);
    tip.innerHTML = `<div class="t">${time.toLocaleTimeString("fr-FR")}</div>` + series.map((se) => `<div class="r"><i style="background:${se.color}"></i>${se.label}<b>${opts.fmt(se.get(best))}</b></div>`).join("");
    tip.hidden = false;
    const left = (bx / W) * r.width;
    tip.style.left = (left + 190 > r.width ? left - 190 : left + 14) + "px";
    tip.style.top = "8px";
  };
  svgEl.onmouseleave = () => {
    tip.hidden = true;
    cursor.setAttribute("x1", -10);
    cursor.setAttribute("x2", -10);
    marks.innerHTML = "";
  };
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.6, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
