"use strict";

const REPO = "https://github.com/Lazizbek-web1/NexVision";
const CLASSES = ["accident", "near_miss", "red_light", "wrong_way", "illegal_u_turn", "stopped_vehicle", "jaywalking",
  "failure_to_yield", "illegal_turn", "solid_line_crossing", "stop_line", "congestion", "road_obstacle", "fire_smoke"];
const GROUPS = [["car", "Cars"], ["person", "People"], ["heavy", "Buses and trucks"], ["two_wheeler", "Bikes"]];
const PAGES = [
  ["home", "Home", "fa-house"], ["team", "Team", "fa-users"], ["approach", "Pipeline", "fa-diagram-project"],
  ["eda", "EDA", "fa-chart-pie"], ["results", "Results", "fa-bolt"], ["demo", "Live demo", "fa-play"],
  ["report", "Report", "fa-file-lines"], ["links", "Links", "fa-link"],
];
// Chart ink follows the page: black axes, mono type, blue marks, coral for alarms.
const INK = "#121212", GRID = "#E5E5E0", BLUE = "#0055FF", CORAL = "#FF5733";
const MONO = "JetBrains Mono, monospace";
const PLOT_CFG = { displayModeBar: false, responsive: true };
const TIME_MARGIN = { l: 136, r: 14, t: 8, b: 34 };   // shared by timeline, risk and counts charts

const $ = (s) => document.querySelector(s);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------- navigation
function navButton(id, label, icon, mobile) {
  const accent = id === "results" ? "bg-brutCoral" : "bg-white";
  return mobile
    ? `<button type="button" data-target="${id}" class="nav-btn p-2 font-mono text-xs font-bold ${accent} brut-border text-center">${label}</button>`
    : `<button type="button" data-target="${id}" class="nav-btn px-3 py-1.5 font-mono text-xs font-bold ${accent} brut-border brut-btn"><i class="fa-solid ${icon} mr-1"></i> ${label}</button>`;
}

function initNav() {
  $("#nav-tabs").innerHTML = PAGES.map(([id, label, icon]) => navButton(id, label, icon, false)).join("");
  $("#mobile-menu").innerHTML = PAGES.map(([id, label, icon]) => navButton(id, label, icon, true)).join("");
  document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => {
    switchTab(b.dataset.target);
    $("#mobile-menu").classList.add("hidden");
  }));
  window.addEventListener("hashchange", () => switchTab(location.hash.slice(1), false));
  switchTab(PAGES.some(([id]) => id === location.hash.slice(1)) ? location.hash.slice(1) : "home", false);
}

// Charts are drawn only on a visible page: Plotly measures its container when it draws, and
// a hidden page has none. Draws requested for a hidden page wait here until it is shown.
const pendingDraws = {};

function whenVisible(pageId, key, draw) {
  if (!document.getElementById(`page-${pageId}`).classList.contains("hidden")) draw();
  else (pendingDraws[pageId] ||= {})[key] = draw;
}

function switchTab(id, updateHash = true) {
  const page = document.getElementById(`page-${id}`);
  if (!page) return;
  document.querySelectorAll(".page-view").forEach((p) => p.classList.toggle("hidden", p !== page));
  Object.values(pendingDraws[id] || {}).forEach((draw) => draw());
  delete pendingDraws[id];
  document.querySelectorAll(".nav-btn").forEach((b) => {
    const on = b.dataset.target === id;
    b.classList.toggle("bg-brutLime", on);
    b.classList.toggle("bg-white", !on && b.dataset.target !== "results");
    b.setAttribute("aria-current", on ? "page" : "false");
  });
  if (updateHash && location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
  window.scrollTo({ top: 0 });
  // charts drawn earlier may have been drawn at another window width
  if (window.Plotly) page.querySelectorAll(".js-plotly-plot").forEach((el) => Plotly.Plots.resize(el));
}

function toggleMobileMenu() { $("#mobile-menu").classList.toggle("hidden"); }

// ---------------------------------------------------------------- chart helpers
function baseLayout(extra = {}) {
  const axis = { gridcolor: GRID, linecolor: INK, linewidth: 2, zeroline: false, tickfont: { family: MONO, size: 10, color: INK } };
  return {
    margin: { l: 46, r: 14, t: 8, b: 34 }, height: 210, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: MONO, size: 11, color: INK },
    hoverlabel: { bgcolor: "#fff", bordercolor: INK, font: { family: MONO, color: INK } },
    showlegend: false, ...extra,
    xaxis: { ...axis, ...(extra.xaxis || {}) }, yaxis: { ...axis, ...(extra.yaxis || {}) },
  };
}

/** Empty a chart container, including Plotly's state (clearing innerHTML alone leaves
 *  el.data behind, and the next Plotly.react then draws nothing). */
function fresh(el) {
  if (window.Plotly) Plotly.purge(el);
  el.innerHTML = "";
}

/** Plotly.react with the container sized to the chart: with responsive: true Plotly draws at
 *  100% of its box, and a box left at its CSS min-height lets the chart spill over the card. */
function plot(el, data, layout, cfg) {
  el.style.height = `${layout.height}px`;
  return Plotly.react(el, data, layout, cfg);
}

function note(el, text) { fresh(el); el.style.height = ""; el.innerHTML = `<p class="font-mono text-xs text-gray-600">${esc(text)}</p>`; }

function playheadShape(t) {
  return { type: "line", xref: "x", yref: "paper", x0: t, x1: t, y0: 0, y1: 1, line: { color: CORAL, width: 2 } };
}

function legend(el, keys = GROUPS) {
  el.innerHTML = keys.map(([k, label]) => `<span style="--c:var(--${k})">${esc(label)}</span>`).join("");
}

function timeline(el, events, duration, onSeek) {
  const present = CLASSES.filter((c) => events.some((e) => e[2] === c));
  if (!present.length) { note(el, "No events in this video."); return; }
  fresh(el);
  plot(el, [{
    type: "bar", orientation: "h", y: events.map((e) => e[2]), x: events.map((e) => e[1] - e[0]), base: events.map((e) => e[0]),
    customdata: events.map((e) => [e[0], e[1]]), width: 0.6,
    marker: { color: BLUE, line: { color: INK, width: 1.5 } },
    hovertemplate: "<b>%{y}</b><br>%{customdata[0]:.1f} – %{customdata[1]:.1f} s<br>click to play<extra></extra>",
  }], baseLayout({
    height: 50 + present.length * 30, margin: TIME_MARGIN, bargap: 0.3,
    xaxis: { range: [0, duration], ticksuffix: " s" },
    yaxis: { categoryorder: "array", categoryarray: [...present].reverse(), gridcolor: "rgba(0,0,0,0)" },
    shapes: [playheadShape(0)],
  }), PLOT_CFG);
  el.on("plotly_click", (d) => onSeek(d.points[0].customdata[0]));
}

function riskChart(el, risk, duration, alarms, onSeek) {
  if (!risk.length) { note(el, "No risk curve for this video yet (not in predictions_samples.json)."); return; }
  fresh(el);
  plot(el, [
    { x: risk.map((r) => r[0]), y: risk.map((r) => r[1]), mode: "lines", line: { color: BLUE, width: 2, shape: "hv" },
      fill: "tozeroy", fillcolor: "rgba(0,85,255,0.12)", hovertemplate: "%{x:.1f} s · risk %{y:.2f}<extra></extra>" },
    { x: [0, duration], y: [0.5, 0.5], mode: "lines", line: { color: INK, width: 1, dash: "dot" }, hoverinfo: "skip" },
    { x: alarms, y: alarms.map(() => 0.5), mode: "markers", marker: { color: CORAL, size: 11, line: { color: INK, width: 2 } },
      hovertemplate: "alarm starts at %{x:.1f} s<extra></extra>" },
  ], baseLayout({
    margin: TIME_MARGIN, xaxis: { range: [0, duration], ticksuffix: " s" }, yaxis: { range: [0, 1.02], dtick: 0.25 },
    shapes: [playheadShape(0)], hovermode: "closest",
    annotations: [{ x: 0, y: 0.5, xanchor: "left", yanchor: "bottom", text: "alarm threshold", showarrow: false,
      font: { family: MONO, size: 10, color: INK } }],
  }), PLOT_CFG);
  el.on("plotly_click", (d) => onSeek(d.points[0].x));
}

function stackedObjects(el, objects, duration, margin = TIME_MARGIN) {
  fresh(el);
  plot(el, GROUPS.map(([k, label]) => ({
    x: objects.t, y: objects[k], name: label, stackgroup: "one", mode: "lines",
    line: { color: cssVar(`--${k}`), width: 1.5 }, fillcolor: cssVar(`--${k}`) + "66",
    hovertemplate: `${label}: %{y:.1f}<extra></extra>`,
  })), baseLayout({ margin, xaxis: { range: [0, duration], ticksuffix: " s" }, hovermode: "x unified", shapes: [playheadShape(0)] }), PLOT_CFG);
}

function lineChart(el, x, y, opts = {}) {
  fresh(el);
  plot(el, [{ x, y, mode: "lines", line: { color: BLUE, width: 2.5 }, connectgaps: false,
    hovertemplate: opts.hover || "%{x}: %{y}<extra></extra>" }],
  baseLayout({ xaxis: { ticksuffix: opts.xsuffix ?? " s" }, yaxis: opts.yaxis || {} }), PLOT_CFG);
}

function eventsTable(el, events, onSeek) {
  if (!events.length) { el.innerHTML = '<p class="font-mono text-xs text-gray-600 p-3">No events.</p>'; return; }
  el.innerHTML = `<table class="brut-table"><thead><tr><th>#</th><th>Event</th><th class="num">Start</th><th class="num">End</th><th class="num">Length</th></tr></thead><tbody>${
    events.map((e, i) => `<tr class="clickable" data-t="${e[0]}" tabindex="0"><td>${i + 1}</td><td><span class="tag">${esc(e[2])}</span></td>
      <td class="num">${e[0].toFixed(1)} s</td><td class="num">${e[1].toFixed(1)} s</td><td class="num">${(e[1] - e[0]).toFixed(1)} s</td></tr>`).join("")
  }</tbody></table>`;
  el.querySelectorAll("tr.clickable").forEach((tr) => {
    const go = () => onSeek(+tr.dataset.t);
    tr.addEventListener("click", go);
    tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(); });
  });
}

/** Keep the playhead on every chart in `els` in step with the video. */
function syncPlayhead(video, els) {
  let last = -1;
  video.ontimeupdate = () => {
    const t = video.currentTime;
    if (Math.abs(t - last) < 0.2) return;
    last = t;
    els.forEach((el) => { if (el.layout?.shapes?.length) Plotly.relayout(el, { "shapes[0].x0": t, "shapes[0].x1": t }); });
  };
}

function seeker(video) {
  return (t) => {
    video.currentTime = Math.max(0, t - 0.5);
    video.play().catch(() => {});
    const r = video.getBoundingClientRect();
    if (r.top < 80 || r.bottom > innerHeight) video.scrollIntoView({ behavior: "smooth", block: "center" });
  };
}

// ---------------------------------------------------------------- sample videos
const videos = {};          // stem -> data json
let index = { videos: [] };

async function loadData() {
  try {
    index = await (await fetch("data/index.json")).json();
  } catch { index = { videos: [] }; }
  await Promise.all(index.videos.map(async (v) => { videos[v.stem] = await (await fetch(`data/${v.stem}.json`)).json(); }));
  const minutes = index.videos.reduce((a, v) => a + v.duration, 0) / 60;
  $("#tile-minutes").textContent = minutes.toFixed(1);
  $("#tile-minutes-note").textContent = `minutes of sample footage · ${index.videos.length} videos · ${index.videos.reduce((a, v) => a + v.events, 0)} events`;
  makeTabs($("#video-tabs"), showResults);
  makeTabs($("#eda-tabs"), showEda);
  edaMeta();
  dashboard();
}

function makeTabs(el, onSelect) {
  el.innerHTML = index.videos.map((v, i) => `<button type="button" role="tab" class="pill" aria-selected="${i === 0}" data-stem="${esc(v.stem)}">${esc(v.name)}</button>`).join("");
  el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", x === b));
    onSelect(b.dataset.stem);
  }));
  if (index.videos.length) onSelect(index.videos[0].stem);
}

function showResults(stem) {
  const d = videos[stem], v = d.video, video = $("#res-video"), seek = seeker(video);
  $("#res-title").textContent = d.name;
  $("#res-sub").textContent = `${v.width}×${v.height} · ${v.fps} fps · ${fmt(v.duration)}`;
  video.poster = d.images.frame;
  video.src = d.media;
  const counts = Object.entries(d.event_counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");
  $("#res-events-sub").textContent = d.events.length ? `${d.events.length} events: ${counts}` : "No events";
  $("#res-risk-sub").textContent = d.risk.length
    ? `${d.alarms.length} alarm${d.alarms.length === 1 ? "" : "s"} (risk ≥ 0.5). There is no crash in this video, so each one is a false alarm.`
    : "";
  eventsTable($("#res-table"), d.events, seek);
  $("#res-examples").innerHTML = d.examples.length ? d.examples.map((x) =>
    `<div class="example" data-t="${x.start}" tabindex="0"><img src="${x.img}" alt="${esc(x.label)} at ${x.start.toFixed(1)} s" loading="lazy">
      <div><span class="tag">${esc(x.label)}</span> ${x.start.toFixed(1)}–${x.end.toFixed(1)} s</div></div>`).join("") : '<p class="font-mono text-xs">No events.</p>';
  $("#res-examples").querySelectorAll(".example").forEach((x) => {
    x.addEventListener("click", () => seek(+x.dataset.t));
    x.addEventListener("keydown", (ev) => { if (ev.key === "Enter") seek(+x.dataset.t); });
  });
  whenVisible("results", "video", () => {
    timeline($("#res-timeline"), d.events, v.duration, seek);
    riskChart($("#res-risk"), d.risk, v.duration, d.alarms, seek);
  });
  syncPlayhead(video, [$("#res-timeline"), $("#res-risk")]);
}

function edaMeta() {
  const rows = index.videos.map((iv) => {
    const d = videos[iv.stem], v = d.video, lum = d.lighting.luminance;
    const mean = lum.length ? lum.reduce((a, b) => a + b, 0) / lum.length : 0;
    const tracks = Object.values(d.tracks).reduce((a, b) => a + b, 0);
    return `<tr><td>${esc(d.name)}</td><td>${v.width}×${v.height}</td><td class="num">${v.fps}</td><td class="num">${fmt(v.duration)}</td>
      <td class="num">${v.frames.toLocaleString()}</td><td class="num">${v.size_mb.toLocaleString()} MB</td><td>${esc(v.codec)}</td>
      <td class="num">${mean.toFixed(0)}</td><td class="num">${tracks.toLocaleString()}</td>
      <td class="num">${d.tracks.car} / ${d.tracks.person} / ${d.tracks.heavy} / ${d.tracks.two_wheeler}</td></tr>`;
  }).join("");
  $("#eda-meta").innerHTML = `<table class="brut-table"><thead><tr><th>Video</th><th>Resolution</th><th class="num">fps</th><th class="num">Length</th>
    <th class="num">Frames</th><th class="num">Size</th><th>Codec</th><th class="num">Brightness</th><th class="num">Tracks</th>
    <th class="num">Cars / people / heavy / bikes</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function showEda(stem) {
  const d = videos[stem];
  $("#img-heat-veh").src = d.images.heat_vehicles;
  $("#img-heat-ppl").src = d.images.heat_people;
  $("#img-tracks").src = d.images.tracks;
  $("#img-lanes").src = d.images.lanes;
  whenVisible("eda", "charts", () => edaCharts(d));
}

function edaCharts(d) {
  legend($("#eda-legend"));
  stackedObjects($("#eda-objects"), d.objects, d.video.duration, { l: 46, r: 14, t: 8, b: 34 });
  lineChart($("#eda-stopped"), d.stopped_share.t, d.stopped_share.share,
    { hover: "%{x} s: %{y:.0f}% stopped<extra></extra>", yaxis: { range: [0, 100], ticksuffix: "%" } });
  const speedGroups = GROUPS.filter(([k]) => d.tracks[k] >= 5);   // a handful of tracks is noise, not a distribution
  legend($("#eda-speed-legend"), speedGroups);
  const sp = $("#eda-speed");
  fresh(sp);
  plot(sp, speedGroups.map(([k, label]) => ({ x: d.speed.bins, y: d.speed[k], name: label, mode: "lines",
    line: { color: cssVar(`--${k}`), width: 2.5 }, hovertemplate: `${label}: %{y:.1f}%<extra></extra>` })),
  baseLayout({ xaxis: { title: { text: "box sizes per second", font: { family: MONO, size: 10 } } }, yaxis: { ticksuffix: "%" },
    hovermode: "x unified", margin: { l: 46, r: 14, t: 8, b: 46 } }), PLOT_CFG);
  lineChart($("#eda-light"), d.lighting.t, d.lighting.luminance, { hover: "%{x} s: brightness %{y:.0f}<extra></extra>", yaxis: { range: [0, 255] } });
}

function dashboard() {
  const all = index.videos.flatMap((iv) => videos[iv.stem].events);
  const hours = index.videos.reduce((a, v) => a + v.duration, 0) / 3600;
  const counts = {};
  all.forEach((e) => { counts[e[2]] = (counts[e[2]] || 0) + 1; });
  const cls = Object.keys(counts).sort((a, b) => counts[a] - counts[b]);
  $("#dash-sub").textContent = `${all.length} events in ${(hours * 60).toFixed(1)} minutes of footage. Bar tips show the raw count.`;
  const perMin = {};
  all.forEach((e) => { const m = Math.floor(e[0] / 60); perMin[m] = (perMin[m] || 0) + 1; });
  const mins = Object.keys(perMin).map(Number).sort((a, b) => a - b);
  whenVisible("results", "dashboard", () => dashboardCharts(cls, counts, hours, mins, perMin));
}

function dashboardCharts(cls, counts, hours, mins, perMin) {
  const a = $("#dash-classes"), b = $("#dash-minutes");
  fresh(a); fresh(b);
  plot(a, [{ type: "bar", orientation: "h", y: cls, x: cls.map((c) => counts[c] / hours), text: cls.map((c) => String(counts[c])),
    textposition: "outside", cliponaxis: false, marker: { color: BLUE, line: { color: INK, width: 1.5 } }, width: 0.6,
    hovertemplate: "%{y}: %{x:.0f} per hour<extra></extra>" }],
  baseLayout({ height: 60 + cls.length * 30, margin: { l: 136, r: 40, t: 8, b: 34 }, yaxis: { gridcolor: "rgba(0,0,0,0)" } }), PLOT_CFG);
  plot(b, [{ type: "bar", x: mins.map((m) => m + 1), y: mins.map((m) => perMin[m]), marker: { color: BLUE, line: { color: INK, width: 1.5 } }, width: 0.6,
    hovertemplate: "minute %{x}: %{y} events<extra></extra>" }],
  baseLayout({ xaxis: { dtick: 1, title: { text: "minute", font: { family: MONO, size: 10 } } }, margin: { l: 46, r: 14, t: 8, b: 46 } }), PLOT_CFG);
}

// ---------------------------------------------------------------- team, links
const LINK_ICONS = { GitHub: "fa-brands fa-github", LinkedIn: "fa-brands fa-linkedin-in", Portfolio: "fa-solid fa-globe" };
const AVATAR = ["bg-brutLime", "bg-brutCoral text-white", "bg-brutBlue text-white"];

async function initTeam() {
  let team = [];
  try { team = await (await fetch("team.json")).json(); } catch { /* none */ }
  $("#team-cards").innerHTML = team.map((p, i) => {
    const initials = p.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const links = Object.entries(p.links || {}).filter(([, u]) => u)
      .map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener" aria-label="${esc(k)}" class="w-9 h-9 bg-black text-white flex items-center justify-center brut-border-2 hover:bg-brutCoral"><i class="${LINK_ICONS[k] || "fa-solid fa-link"}"></i></a>`).join("");
    return `<div class="bg-white brut-border p-6 shadow-brut space-y-4">
      <div class="w-20 h-20 ${AVATAR[i % AVATAR.length]} brut-border mx-auto flex items-center justify-center text-3xl font-black font-mono shadow-brut-sm">${esc(initials)}</div>
      <div class="text-center"><h3 class="font-mono font-black text-lg">${esc(p.name)}</h3>
        <span class="text-xs font-mono font-bold bg-brutYellow px-2 py-0.5 brut-border-2 inline-block mt-1">${esc(p.role)}</span></div>
      <p class="text-sm font-medium text-gray-700">${esc(p.did)}</p>
      ${p.proud ? `<p class="text-xs font-medium bg-brutBg p-2 brut-border-2"><b class="font-mono uppercase">Proud of:</b> ${esc(p.proud)}</p>` : ""}
      ${links ? `<div class="flex justify-center gap-3">${links}</div>` : ""}
    </div>`;
  }).join("");
}

function boxKey() {
  const key = GROUPS.map(([k, label]) => `<span style="color:var(--${k})">■</span> ${label.toLowerCase()}`).join(" · ");
  document.querySelectorAll(".box-key").forEach((el) => { el.innerHTML = `Boxes: ${key} · green tint: the carriageway learned from traffic`; });
}

window.addEventListener("DOMContentLoaded", () => {
  $("#link-repo").href = REPO;
  $("#link-repo-label").textContent = REPO.replace("https://", "");
  initNav();
  boxKey();
  initTeam();
  const start = () => (window.Plotly ? loadData() : setTimeout(start, 50));
  start();
});
