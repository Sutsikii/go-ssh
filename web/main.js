"use strict";

// Boot: the pinned server list, then the inventory and live statuses.

async function boot() {
  initSidebar();
  initTabs();
  initPalette();
  initEditor();
  initShortcuts();
  addTab(newHomeTab());

  window.mygo.on("status", (st) => {
    state.status.set(st.id, st);
    if (st.latest && st.state === "online") {
      const s = spark.get(st.id) || [];
      s.push(st.latest.cpu);
      if (s.length > 40) s.shift();
      spark.set(st.id, s);
    }
    for (const t of state.tabs) t.status?.(st);
    scheduleHome();
  });

  try {
    const [inv, statuses, info] = await Promise.all([go("Servers.List"), go("Monitor.Statuses"), go("App.Info")]);
    state.settings = info;
    for (const st of statuses) state.status.set(st.id, st);
    applyInventory(inv);
  } catch (e) {
    toast(errText(e), true);
  }
  // Times such as "seen 4 s ago" age.
  setInterval(scheduleHome, 15000);
}

boot();
