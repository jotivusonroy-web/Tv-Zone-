(() => {
  "use strict";

  const state = {
    all: [],
    filtered: [],
    category: "All",
    query: "",
    sort: "default",
    favorites: new Set(JSON.parse(localStorage.getItem("rajibtv-favorites") || "[]")),
    hls: null
  };

  const $ = (s) => document.querySelector(s);
  const grid = $("#channelGrid");
  const empty = $("#emptyState");
  const search = $("#searchInput");
  const sort = $("#sortSelect");
  const tabs = $("#categoryTabs");
  const modal = $("#playerModal");
  const video = $("#videoPlayer");
  const title = $("#playerTitle");
  const fallback = $("#videoFallback");

  function saveFavs() {
    localStorage.setItem("rajibtv-favorites", JSON.stringify([...state.favorites]));
    $("#favoriteCount").textContent = state.favorites.size;
  }

  function channelName(c) {
    return c.name || c.title || c.channel_name || "Unnamed Channel";
  }

  function streamUrl(c) {
    return c.url || c.stream || c.stream_url || c.src || "";
  }

  function logoUrl(c) {
    return c.logo || c.tvgLogo || c.tvg_logo || c.image || "";
  }

  function categoryOf(c) {
    return c.category || c.group || c.groupTitle || c.group_title || "Other";
  }

  function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "TV";
  }

  function safeUrl(url) {
    try {
      const u = new URL(url, location.href);
      return ["http:", "https:"].includes(u.protocol) ? u.href : "";
    } catch { return ""; }
  }

  function buildTabs() {
    const cats = [...new Set(state.all.map(categoryOf))].sort((a,b) => a.localeCompare(b));
    tabs.innerHTML = `<button class="tab active" data-category="All">All <i>${state.all.length}</i></button>`;
    cats.forEach(cat => {
      const count = state.all.filter(c => categoryOf(c) === cat).length;
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.dataset.category = cat;
      btn.innerHTML = `${escapeHtml(cat)} <i>${count}</i>`;
      tabs.appendChild(btn);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[m]));
  }

  function apply() {
    const q = state.query.toLowerCase().trim();
    let list = state.all.filter(c => {
      const catOk = state.category === "All" || categoryOf(c) === state.category;
      const text = `${channelName(c)} ${categoryOf(c)}`.toLowerCase();
      return catOk && (!q || text.includes(q));
    });

    if (state.sort === "az") list.sort((a,b) => channelName(a).localeCompare(channelName(b)));
    if (state.sort === "za") list.sort((a,b) => channelName(b).localeCompare(channelName(a)));
    if (state.sort === "favorites") list.sort((a,b) => {
      return Number(state.favorites.has(idOf(b))) - Number(state.favorites.has(idOf(a)));
    });

    state.filtered = list;
    render();
  }

  function idOf(c, index = "") {
    return String(c.id || c.channel_id || `${channelName(c)}|${streamUrl(c)}` || index);
  }

  function render() {
    grid.innerHTML = "";
    $("#channelCount").textContent = state.all.length;
    $("#categoryCount").textContent = new Set(state.all.map(categoryOf)).size;
    $("#favoriteCount").textContent = state.favorites.size;
    $("#resultText").textContent = `Showing ${state.filtered.length} of ${state.all.length} channels`;

    empty.classList.toggle("hidden", state.filtered.length !== 0);

    state.filtered.forEach((c, index) => {
      const name = channelName(c);
      const cat = categoryOf(c);
      const logo = safeUrl(logoUrl(c));
      const id = idOf(c, index);
      const card = document.createElement("article");
      card.className = "channel-card";
      card.innerHTML = `
        <div class="card-top">
          <span class="live-badge">● LIVE</span>
          <button class="fav-btn ${state.favorites.has(id) ? "active" : ""}" data-fav="${escapeHtml(id)}" title="Favorite">★</button>
        </div>
        <button class="channel-main" data-play="${escapeHtml(id)}">
          <div class="logo-box">
            ${logo ? `<img src="${escapeHtml(logo)}" alt="" loading="lazy" onerror="this.remove();this.parentNode.classList.add('fallback-logo');this.parentNode.insertAdjacentHTML('beforeend','<b>${escapeHtml(initials(name))}</b>')">`
                   : `<b>${escapeHtml(initials(name))}</b>`}
          </div>
          <div class="channel-info">
            <h3>${escapeHtml(name)}</h3>
            <span>${escapeHtml(cat)}</span>
          </div>
        </button>
        <button class="watch-btn" data-play="${escapeHtml(id)}">WATCH NOW <span>→</span></button>
      `;
      grid.appendChild(card);
    });
  }

  function openPlayer(c) {
    const url = safeUrl(streamUrl(c));
    if (!url) return;

    title.textContent = channelName(c);
    modal.classList.remove("hidden");
    fallback.classList.add("hidden");
    video.classList.remove("hidden");
    video.pause();
    video.removeAttribute("src");
    video.load();

    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }

    const isHls = /\.m3u8($|\?)/i.test(url);

    if (isHls && window.Hls && Hls.isSupported()) {
      state.hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      state.hls.loadSource(url);
      state.hls.attachMedia(video);
      state.hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      state.hls.on(Hls.Events.ERROR, (_, data) => {
        if (data && data.fatal) showFallback();
      });
    } else {
      video.src = url;
      video.addEventListener("loadedmetadata", () => video.play().catch(() => {}), { once: true });
      video.addEventListener("error", showFallback, { once: true });
    }
  }

  function showFallback() {
    video.pause();
    video.classList.add("hidden");
    fallback.classList.remove("hidden");
  }

  function closePlayer() {
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }
    video.pause();
    video.removeAttribute("src");
    video.load();
    modal.classList.add("hidden");
  }

  tabs.addEventListener("click", e => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    state.category = btn.dataset.category;
    tabs.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    apply();
  });

  search.addEventListener("input", e => {
    state.query = e.target.value;
    apply();
  });

  sort.addEventListener("change", e => {
    state.sort = e.target.value;
    apply();
  });

  grid.addEventListener("click", e => {
    const fav = e.target.closest("[data-fav]");
    if (fav) {
      const id = fav.dataset.fav;
      state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
      saveFavs();
      apply();
      return;
    }
    const play = e.target.closest("[data-play]");
    if (play) {
      const c = state.all.find((x, i) => idOf(x, i) === play.dataset.play);
      if (c) openPlayer(c);
    }
  });

  $("#closePlayer").addEventListener("click", closePlayer);
  modal.addEventListener("click", e => { if (e.target === modal) closePlayer(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePlayer(); });

  async function loadChannels() {
    try {
      const res = await fetch(`channels.json?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.all = Array.isArray(data) ? data : (data.channels || data.data || []);
      buildTabs();
      apply();
      $("#statusText").innerHTML = `<i></i> ${state.all.length ? "LIVE" : "EMPTY"}`;
    } catch (err) {
      console.error(err);
      state.all = [];
      render();
      $("#resultText").textContent = "Could not load channels.json";
      $("#statusText").innerHTML = `<i class="offline"></i> ERROR`;
      empty.classList.remove("hidden");
      empty.innerHTML = `channels.json could not be loaded.<br><small>Make sure channels.json is in the same GitHub folder as index.html.</small>`;
    }
  }

  loadChannels();
})();
