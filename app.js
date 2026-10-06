(() => {
  "use strict";

  const LOGO_API = "https://iptv-org.github.io/api/logos.json";
  const CHANNEL_API = "https://iptv-org.github.io/api/channels.json";
  const HIDDEN_KEY = "rajibtv-unavailable-v1";

  const state = {
    all: [],
    filtered: [],
    category: "All",
    query: "",
    sort: "default",
    favorites: new Set(JSON.parse(localStorage.getItem("rajibtv-favorites") || "[]")),
    unavailable: new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]")),
    logoMap: new Map(),
    hls: null,
    activeId: null
  };

  const $ = s => document.querySelector(s);
  const grid = $("#channelGrid"), empty = $("#emptyState"), search = $("#searchInput");
  const sort = $("#sortSelect"), tabs = $("#categoryTabs"), modal = $("#playerModal");
  const video = $("#videoPlayer"), title = $("#playerTitle"), fallback = $("#videoFallback");

  const clean = s => String(s || "")
    .toLowerCase()
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(1080p|720p|576p|504p|480p|396p|sd|hd|fhd|uhd)\b/gi, " ")
    .replace(/[^a-z0-9]+/g, "");

  const nameOf = c => c.name || c.title || c.channel_name || "Unnamed Channel";
  const urlOf = c => c.url || c.stream || c.stream_url || c.src || "";
  const groupOf = c => c.category || c.group || c.groupTitle || c.group_title || "Entertainment";
  const idOf = c => String(c.id || c.channel_id || `${nameOf(c)}|${urlOf(c)}`);
  const safeUrl = u => { try { const x = new URL(u, location.href); return ["http:","https:"].includes(x.protocol) ? x.href : ""; } catch { return ""; } };
  const esc = s => String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
  const initials = n => n.trim().split(/\s+/).slice(0,2).map(x => x[0]).join("").toUpperCase() || "TV";

  function persist() {
    localStorage.setItem("rajibtv-favorites", JSON.stringify([...state.favorites]));
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...state.unavailable]));
  }

  function markUnavailable(c) {
    const id = idOf(c);
    state.unavailable.add(id);
    state.favorites.delete(id);
    persist();
    closePlayer();
    apply();
  }

  async function fetchJson(url, ms = 7000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      return await r.json();
    } finally { clearTimeout(t); }
  }

  function buildLogoMap(apiChannels, logos) {
    const aliases = new Map();
    for (const c of (apiChannels || [])) {
      const id = c.id;
      const names = [c.name, ...(c.alt_names || [])].filter(Boolean);
      for (const n of names) aliases.set(clean(n), id);
    }
    const best = new Map();
    for (const l of (logos || [])) {
      if (!l.url || l.in_use === false) continue;
      const score = (l.in_use ? 100 : 0) + (l.tags?.includes("color") ? 5 : 0);
      const old = best.get(l.channel);
      if (!old || score > old.score) best.set(l.channel, {url:l.url, score});
    }
    for (const [name, id] of aliases) {
      const logo = best.get(id);
      if (logo) state.logoMap.set(name, logo.url);
    }
  }

  function logoFor(c) {
    const existing = c.logo || c.tvgLogo || c.tvg_logo || "";
    if (existing && !/m3uworld4k/i.test(existing)) return existing;
    const n = clean(nameOf(c));
    if (state.logoMap.has(n)) return state.logoMap.get(n);
    // progressively try shorter normalized names
    for (const [key, url] of state.logoMap) {
      if (key.length >= 5 && (n.includes(key) || key.includes(n))) return url;
    }
    return "";
  }

  function buildTabs() {
    const cats = [...new Set(state.all.map(groupOf))].sort((a,b) => a.localeCompare(b));
    tabs.innerHTML = `<button class="tab active" data-category="All">All <i>${state.all.length}</i></button>`;
    cats.forEach(cat => {
      const count = state.all.filter(c => groupOf(c) === cat).length;
      const b = document.createElement("button");
      b.className = "tab"; b.dataset.category = cat;
      b.innerHTML = `${esc(cat)} <i>${count}</i>`;
      tabs.appendChild(b);
    });
  }

  function apply() {
    const q = state.query.toLowerCase().trim();
    let list = state.all.filter(c => {
      if (state.unavailable.has(idOf(c))) return false;
      const text = `${nameOf(c)} ${groupOf(c)}`.toLowerCase();
      return (state.category === "All" || groupOf(c) === state.category) && (!q || text.includes(q));
    });

    if (state.sort === "az") list.sort((a,b) => nameOf(a).localeCompare(nameOf(b)));
    if (state.sort === "za") list.sort((a,b) => nameOf(b).localeCompare(nameOf(a)));
    if (state.sort === "favorites") list.sort((a,b) => Number(state.favorites.has(idOf(b))) - Number(state.favorites.has(idOf(a))));

    state.filtered = list;
    render();
  }

  function render() {
    grid.innerHTML = "";
    $("#channelCount").textContent = state.filtered.length;
    $("#categoryCount").textContent = new Set(state.filtered.map(groupOf)).size;
    $("#favoriteCount").textContent = state.favorites.size;
    $("#resultText").textContent = `Showing ${state.filtered.length} working channels`;
    empty.classList.toggle("hidden", state.filtered.length !== 0);

    state.filtered.forEach(c => {
      const name = nameOf(c), cat = groupOf(c), id = idOf(c), logo = safeUrl(logoFor(c));
      const card = document.createElement("article");
      card.className = "channel-card";
      card.innerHTML = `
        <div class="card-top">
          <span class="live-badge">● LIVE</span>
          <button class="fav-btn ${state.favorites.has(id) ? "active" : ""}" data-fav="${esc(id)}">★</button>
        </div>
        <button class="channel-main" data-play="${esc(id)}">
          <div class="logo-box">
            ${logo ? `<img src="${esc(logo)}" alt="${esc(name)}" loading="lazy" onerror="this.remove();this.parentNode.classList.add('fallback-logo');this.parentNode.insertAdjacentHTML('beforeend','<b>${esc(initials(name))}</b>')">`
                   : `<b>${esc(initials(name))}</b>`}
          </div>
          <div class="channel-info"><h3>${esc(name)}</h3><span>${esc(cat)}</span></div>
        </button>
        <button class="watch-btn" data-play="${esc(id)}">WATCH NOW <span>→</span></button>
      `;
      grid.appendChild(card);
    });
  }

  function showFallback() {
    video.pause(); video.classList.add("hidden"); fallback.classList.remove("hidden");
  }

  function openPlayer(c) {
    const url = safeUrl(urlOf(c)); if (!url) return;
    state.activeId = idOf(c);
    title.textContent = nameOf(c);
    modal.classList.remove("hidden"); fallback.classList.add("hidden"); video.classList.remove("hidden");
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    video.pause(); video.removeAttribute("src"); video.load();

    const fail = () => { showFallback(); setTimeout(() => markUnavailable(c), 1200); };
    const isHls = /\.m3u8($|\?)/i.test(url);

    if (isHls && window.Hls && Hls.isSupported()) {
      state.hls = new Hls({enableWorker:true, lowLatencyMode:true});
      state.hls.loadSource(url); state.hls.attachMedia(video);
      state.hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(()=>{}));
      state.hls.on(Hls.Events.ERROR, (_, data) => { if (data?.fatal) fail(); });
    } else {
      video.src = url;
      video.addEventListener("loadedmetadata", () => video.play().catch(()=>{}), {once:true});
      video.addEventListener("error", fail, {once:true});
    }
  }

  function closePlayer() {
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    video.pause(); video.removeAttribute("src"); video.load(); modal.classList.add("hidden");
    state.activeId = null;
  }

  tabs.addEventListener("click", e => {
    const b = e.target.closest(".tab"); if (!b) return;
    state.category = b.dataset.category;
    tabs.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); apply();
  });
  search.addEventListener("input", e => { state.query = e.target.value; apply(); });
  sort.addEventListener("change", e => { state.sort = e.target.value; apply(); });

  grid.addEventListener("click", e => {
    const f = e.target.closest("[data-fav]");
    if (f) {
      const id = f.dataset.fav;
      state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
      persist(); apply(); return;
    }
    const p = e.target.closest("[data-play]");
    if (p) {
      const c = state.all.find(x => idOf(x) === p.dataset.play);
      if (c) openPlayer(c);
    }
  });

  $("#closePlayer").addEventListener("click", closePlayer);
  modal.addEventListener("click", e => { if (e.target === modal) closePlayer(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePlayer(); });

  async function load() {
    try {
      const r = await fetch(`channels.json?v=${Date.now()}`, {cache:"no-store"});
      if (!r.ok) throw new Error(`channels.json ${r.status}`);
      state.all = await r.json();
      buildTabs(); apply();
      // Real channel logos from the public iptv-org database.
      try {
        const [apiChannels, logos] = await Promise.all([fetchJson(CHANNEL_API), fetchJson(LOGO_API)]);
        buildLogoMap(apiChannels, logos);
        render();
      } catch (logoErr) {
        console.warn("Logo database unavailable; using fallback logos.", logoErr);
      }
      $("#statusText").innerHTML = `<i></i> LIVE`;
    } catch (e) {
      console.error(e);
      $("#resultText").textContent = "Could not load channels.json";
      $("#statusText").innerHTML = `<i class="offline"></i> ERROR`;
      empty.classList.remove("hidden");
    }
  }

  load();
})();