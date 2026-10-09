// GTNH Block Palette: client-side nearest-colour search over baked block data.
// Data comes from window.PALETTE_DATA (written by bake.py); no server needed.
(() => {
  "use strict";

  const FLAG = { GRAYSCALE: 1, ANIMATED: 2, CUTOUT: 4, TRANSLUCENT: 8, LANG: 16 };
  const DOM_WEIGHT_PENALTY = 0.08; // dominant mode: how much a minor colour is discounted
  const NOISE_MAX = 0.6;           // noise slider at 100% multiplies spread by this

  // --- colour math (must match bake.py) ---------------------------------------
  const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  function hexToOklab(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = toLinear(((n >> 16) & 255) / 255), g = toLinear(((n >> 8) & 255) / 255), b = toLinear((n & 255) / 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
  }
  function oklabToHex([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
    return "#" + lin.map(c => {
      c = Math.min(1, Math.max(0, c));
      c = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
      return Math.round(c * 255).toString(16).padStart(2, "0");
    }).join("");
  }

  // --- data decode ------------------------------------------------------------
  const D = window.PALETTE_DATA;
  if (!D) {
    document.getElementById("status").textContent = "No palette data found. Run bake.py.";
    return;
  }
  function decodeInt16(b64, scale) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ints = new Int16Array(bytes.buffer);
    const out = new Float32Array(ints.length);
    for (let i = 0; i < ints.length; i++) out[i] = ints[i] / scale;
    return out;
  }
  const N = D.count, K = D.k;
  const AVG = decodeInt16(D.avg, D.scale);       // [L,a,b] * N
  const DOM = decodeInt16(D.dom, D.scale);       // [L,a,b,w] * K * N
  const SPREAD = decodeInt16(D.spread, D.scale); // N

  // --- search -----------------------------------------------------------------
  // Returns every allowed block as [{i, d, s}], best first. d is the colour distance (OKLab, *100 ~ deltaE).
  function search(q, opts) {
    const [qL, qa, qb] = q;
    const noise = opts.noise * NOISE_MAX;
    const scored = [];
    for (let i = 0; i < N; i++) {
      if (!opts.allow(i)) continue;
      let d;
      if (opts.mode === "dom") {
        d = Infinity;
        for (let k = 0; k < K; k++) {
          const o = (i * K + k) * 4, w = DOM[o + 3];
          if (w <= 0) break;
          const dd = Math.hypot(DOM[o] - qL, DOM[o + 1] - qa, DOM[o + 2] - qb) + DOM_WEIGHT_PENALTY * (1 - w);
          if (dd < d) d = dd;
        }
      } else {
        const o = i * 3;
        d = Math.hypot(AVG[o] - qL, AVG[o + 1] - qa, AVG[o + 2] - qb);
      }
      scored.push({ i, d, s: d + noise * SPREAD[i] });
    }
    scored.sort((x, y) => x.s - y.s);
    return scored;
  }


  // --- UI ---------------------------------------------------------------------
  const PAGE = 12;       // matches shown at first and added per "show more"
  const MAX_SHOWN = 240;
  const CFG = window.SITE_CONFIG || {};

  const $ = id => document.getElementById(id);
  const el = {
    color: $("color"), hex: $("hex"), eyedrop: $("eyedrop"), random: $("random"), helpBtn: $("helpBtn"),
    mode: $("mode"), noise: $("noise"), optSummary: $("optSummary"),
    fTinted: $("fTinted"), fTransparent: $("fTransparent"), fAnimated: $("fAnimated"),
    modList: $("modList"), modSearch: $("modSearch"), modSummary: $("modSummary"),
    status: $("status"), results: $("results"), more: $("more"), foot: $("foot"),
    help: $("help"), report: $("report"), reportForm: $("reportForm"),
    rTile: $("rTile"), rName: $("rName"), rMod: $("rMod"), rComment: $("rComment"),
    rStatus: $("rStatus"), rCopy: $("rCopy"), rSend: $("rSend"),
  };

  // Distance thresholds (OKLab * 100) for the human-readable match labels.
  const QUALITY = [[1.5, "Near-identical", "q1"], [3, "Very close", "q2"], [6, "Close", "q3"], [10, "Similar", "q4"], [Infinity, "Loose", "q5"]];
  const quality = d => QUALITY.find(([max]) => d * 100 < max);

  const modCounts = new Array(D.mods.length).fill(0);
  for (let i = 0; i < N; i++) modCounts[D.mod[i]]++;
  const modOn = new Array(D.mods.length).fill(true);

  function buildModList() {
    el.modList.innerHTML = "";
    const order = D.mods.map((m, i) => i).sort((a, b) => D.mods[a].localeCompare(D.mods[b]));
    for (const m of order) {
      const lab = document.createElement("label");
      lab.dataset.mod = m;
      lab.dataset.name = D.mods[m].toLowerCase();
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = modOn[m];
      cb.onchange = () => { modOn[m] = cb.checked; update(); };
      const small = document.createElement("small");
      small.textContent = modCounts[m];
      lab.append(cb, " " + D.mods[m], small);
      el.modList.append(lab);
    }
    filterModList();
  }
  function filterModList() {
    const q = el.modSearch.value.toLowerCase();
    for (const lab of el.modList.children) lab.hidden = q && !lab.dataset.name.includes(q);
  }
  el.modSearch.oninput = filterModList;
  function setVisibleMods(on) {
    for (const lab of el.modList.children) if (!lab.hidden) modOn[+lab.dataset.mod] = on;
    buildModList();
    update();
  }
  $("modAll").onclick = () => setVisibleMods(true);
  $("modNone").onclick = () => setVisibleMods(false);

  function allowFn() {
    const tinted = el.fTinted.checked, transp = el.fTransparent.checked, anim = el.fAnimated.checked;
    return i => {
      const f = D.flags[i];
      if (!modOn[D.mod[i]]) return false;
      if (!tinted && f & FLAG.GRAYSCALE) return false;
      if (!transp && f & (FLAG.CUTOUT | FLAG.TRANSLUCENT)) return false;
      if (!anim && f & FLAG.ANIMATED) return false;
      return true;
    };
  }

  function tileStyle(i) {
    const a = Math.floor(i / D.perAtlas), slot = i % D.perAtlas;
    const x = slot % D.atlasCols, y = Math.floor(slot / D.atlasCols);
    // Percent positioning keeps the tile scaled to whatever size its box is.
    const rows = Math.ceil(Math.min(D.perAtlas, N - a * D.perAtlas) / D.atlasCols);
    const px = D.atlasCols > 1 ? (x / (D.atlasCols - 1)) * 100 : 0;
    const py = rows > 1 ? (y / (rows - 1)) * 100 : 0;
    return `background-image:url("${D.atlases[a]}");background-size:${D.atlasCols * 100}% ${rows * 100}%;` +
           `background-position:${px}% ${py}%`;
  }

  function swatches(i) {
    const out = [];
    for (let k = 0; k < K; k++) {
      const o = (i * K + k) * 4, w = DOM[o + 3];
      if (w <= 0) break;
      out.push(`<span style="background:${oklabToHex([DOM[o], DOM[o + 1], DOM[o + 2]])};width:${(w * 100).toFixed(1)}%"></span>`);
    }
    return out.join("");
  }

  function card(r, rank) {
    const i = r.i;
    const [, label, cls] = quality(r.d);
    const c = document.createElement("div");
    c.className = "card" + (rank === 0 ? " best" : "");
    c.tabIndex = 0;
    c.setAttribute("role", "button");
    c.title = `${D.name[i]} (${D.mods[D.mod[i]]})\nClick to find blocks similar to this one`;
    c.innerHTML =
      `<div class="tilebox"><div class="tile" style='${tileStyle(i)}'></div></div>` +
      (rank === 0 ? `<span class="rank">Best match</span>` : "") +
      `<div class="name"></div><div class="mod"></div>` +
      `<div class="sw" title="Main colours in this texture">${swatches(i)}</div>` +
      `<div class="row"><span class="q ${cls}" title="Colour difference: ${(r.d * 100).toFixed(1)}">${label}</span>` +
      `<button class="report-btn" type="button" title="Report a problem with this block">Report</button></div>`;
    c.querySelector(".name").textContent = D.name[i];
    c.querySelector(".mod").textContent = D.mods[D.mod[i]];
    const findSimilar = () => { setColor(D.hex[i]); window.scrollTo({ top: 0, behavior: "smooth" }); };
    c.onclick = findSimilar;
    c.onkeydown = e => { if (e.key === "Enter" && e.target === c) findSimilar(); };
    c.querySelector(".report-btn").onclick = e => { e.stopPropagation(); openReport(i); };
    return c;
  }

  function normHex(v) {
    v = v.trim().toLowerCase();
    if (!v.startsWith("#")) v = "#" + v;
    if (/^#[0-9a-f]{3}$/.test(v)) v = "#" + [...v.slice(1)].map(c => c + c).join("");
    return /^#[0-9a-f]{6}$/.test(v) ? v : null;
  }
  function setColor(hex) {
    el.color.value = hex;
    el.hex.value = hex;
    el.hex.classList.remove("bad");
    update();
  }

  // --- search + rendering -----------------------------------------------------
  let ranked = [], shown = PAGE, currentHex = "", pending = 0;
  function update() {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(run);
  }
  function run() {
    const hex = normHex(el.hex.value);
    if (!hex) return;
    currentHex = hex;
    ranked = search(hexToOklab(hex), { mode: el.mode.value, noise: el.noise.value / 100, allow: allowFn() });
    shown = PAGE;
    render();
    const onMods = modOn.filter(Boolean).length;
    el.modSummary.textContent = onMods === D.mods.length ? "(all selected)" : `(${onMods} of ${D.mods.length} selected)`;
    const extras = [el.fTransparent.checked && "see-through", el.fTinted.checked && "tinted"].filter(Boolean);
    el.optSummary.textContent = "· " + [el.mode.value === "dom" ? "main colour" : "overall colour",
      onMods === D.mods.length ? "all mods" : `${onMods} mods`, ...extras].join(" · ");
    saveState(hex);
  }
  function render() {
    const list = ranked.slice(0, shown);
    el.results.replaceChildren(...list.map(card));
    if (!ranked.length) {
      el.status.textContent = "No blocks match these filters. Try selecting more mods in Search options.";
    } else {
      el.status.textContent = `Top ${list.length} of ${ranked.length} blocks for ${currentHex}. Click a block to find similar ones.`;
    }
    el.more.hidden = shown >= Math.min(ranked.length, MAX_SHOWN);
  }
  el.more.onclick = () => { shown = Math.min(shown + PAGE, MAX_SHOWN); render(); };

  // --- reports ----------------------------------------------------------------
  const REASON_LABELS = {
    not_decorative: "Not a decorative block", wrong_name: "Wrong name", broken_texture: "Broken texture",
    wrong_mod: "Wrong mod", duplicate: "Duplicate", other: "Other",
  };
  const REPORTED_KEY = "palette.reported";
  const COOLDOWN_MS = 15000;
  let reportIdx = -1;

  function loadReported() {
    try { return JSON.parse(localStorage.getItem(REPORTED_KEY) || "{}"); } catch { return {}; }
  }
  function markReported(id) {
    const r = loadReported();
    r[id] = Date.now();
    r._last = Date.now();
    try { localStorage.setItem(REPORTED_KEY, JSON.stringify(r)); } catch { /* storage unavailable */ }
  }

  function openReport(i) {
    reportIdx = i;
    el.reportForm.reset();
    el.rTile.setAttribute("style", tileStyle(i));
    el.rName.textContent = D.name[i];
    el.rMod.textContent = `${D.mods[D.mod[i]]} · ${D.id[i]}`;
    el.rCopy.hidden = true;
    el.rSend.disabled = false;
    el.rSend.hidden = false;
    const already = loadReported()[D.id[i]];
    setRStatus(already ? "You've already reported this block. Thanks! You can still add another report." : "", "");
    el.report.showModal();
  }
  function setRStatus(text, cls) {
    el.rStatus.textContent = text;
    el.rStatus.className = "rstatus " + cls;
  }

  function reportPayload(reason, comment) {
    const i = reportIdx;
    return {
      id: D.id[i], name: D.name[i], mod: D.mods[D.mod[i]], reason, reasonLabel: REASON_LABELS[reason],
      comment, query: currentHex, build: D.built,
    };
  }
  // Discord embed, same format as worker/report-worker.js.
  function discordMessage(r) {
    return {
      username: "Palette reports",
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `Report: ${r.name}`.slice(0, 250), color: 0xd04b3b,
        fields: [
          { name: "Reason", value: r.reasonLabel, inline: true },
          { name: "Mod", value: r.mod || "-", inline: true },
          { name: "Texture id", value: "`" + r.id + "`" },
          { name: "Comment", value: r.comment || "-" },
          { name: "Searched colour", value: r.query || "-", inline: true },
          { name: "Build", value: r.build || "-", inline: true },
        ],
      }],
    };
  }

  async function sendReport(r) {
    const mode = CFG.report?.mode || "none", url = CFG.report?.url;
    if (mode === "worker" && url) {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r) });
      if (!res.ok) throw new Error(`server answered ${res.status}`);
      return true;
    }
    if (mode === "discord" && url) {
      // multipart + no-cors: a "simple" request, so it works without CORS headers
      // from Discord. The response is opaque, so success can't be confirmed.
      const fd = new FormData();
      fd.append("payload_json", JSON.stringify(discordMessage(r)));
      await fetch(url, { method: "POST", mode: "no-cors", body: fd });
      return true;
    }
    return false; // not configured
  }

  el.reportForm.onsubmit = async e => {
    e.preventDefault();
    const reason = new FormData(el.reportForm).get("reason");
    if (!reason) { setRStatus("Please choose what's wrong.", "err"); return; }
    const last = loadReported()._last || 0;
    if (Date.now() - last < COOLDOWN_MS) {
      setRStatus("Please wait a few seconds before sending another report.", "err");
      return;
    }
    const r = reportPayload(reason, el.rComment.value.trim().slice(0, 500));
    el.rSend.disabled = true;
    setRStatus("Sending…", "");
    try {
      if (await sendReport(r)) {
        markReported(r.id);
        setRStatus("Thanks! Your report was sent.", "ok");
        el.rSend.hidden = true;
        setTimeout(() => el.report.open && el.report.close(), 1600);
      } else {
        el.rCopy.value = `Block report\n${r.name} (${r.mod})\nid: ${r.id}\nreason: ${r.reasonLabel}\n` +
                         (r.comment ? `comment: ${r.comment}\n` : "") + `build: ${r.build}`;
        el.rCopy.hidden = false;
        el.rCopy.select();
        setRStatus("Online reporting isn't set up yet. Copy this text and send it to the site author.", "");
        el.rSend.disabled = false;
      }
    } catch (err) {
      setRStatus(`Couldn't send the report (${err.message}). Please try again later.`, "err");
      el.rSend.disabled = false;
    }
  };

  // --- footer -------------------------------------------------------------------
  function buildFooter() {
    const f = CFG.footer || {};
    const make = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text) n.textContent = text;
      return n;
    };
    const about = make("div", "foot-about");
    about.append(make("div", "foot-title", "GTNH Block Palette"));
    if (f.author) {
      const p = make("p", "", "Made by ");
      p.append(make("span", "foot-author", f.author));
      about.append(p);
    }
    if (f.note) about.append(make("p", "", f.note));

    const links = make("nav", "links");
    links.setAttribute("aria-label", "Links");
    for (const l of f.links || []) {
      if (!l.url) continue;
      const a = make("a", "", l.label);
      a.href = l.url;
      a.target = "_blank";
      a.rel = "noopener";
      links.append(a);
    }
    const inner = make("div", "foot-inner");
    inner.append(about, links);

    const meta = make("div", "foot-meta");
    meta.append(make("span", "", `${N.toLocaleString("en")} blocks · ${D.mods.length} mods · data baked ${D.built}`));
    const tip = make("span", "", "Spotted a wrong block? Use Report on its card. ");
    const how = make("button", "", "How it works");
    how.type = "button";
    how.onclick = () => el.help.showModal();
    tip.append(how);
    meta.append(tip);
    el.foot.replaceChildren(inner, meta);
  }

  // --- state in URL hash (shareable) -----------------------------------------
  function saveState(hex) {
    const p = new URLSearchParams({
      c: hex.slice(1), m: el.mode.value, n: el.noise.value,
      f: [el.fTinted.checked && "t", el.fTransparent.checked && "x", el.fAnimated.checked && "a"].filter(Boolean).join(""),
    });
    const off = modOn.map((on, i) => (on ? null : i)).filter(i => i !== null);
    if (off.length) p.set("off", off.map(i => D.mods[i]).join("|"));
    history.replaceState(null, "", "#" + p.toString());
  }
  function loadState() {
    const p = new URLSearchParams(location.hash.slice(1));
    const hex = p.get("c") && normHex(p.get("c"));
    if (hex) { el.color.value = hex; el.hex.value = hex; }
    if (p.get("m")) el.mode.value = p.get("m");
    if (p.get("n")) el.noise.value = p.get("n");
    if (p.has("f")) {
      const f = p.get("f");
      el.fTinted.checked = f.includes("t");
      el.fTransparent.checked = f.includes("x");
      el.fAnimated.checked = f.includes("a");
    }
    const off = new Set((p.get("off") || "").split("|").filter(Boolean));
    D.mods.forEach((m, i) => (modOn[i] = !off.has(m)));
  }

  // --- wiring -------------------------------------------------------------------
  el.color.oninput = () => { el.hex.value = el.color.value; el.hex.classList.remove("bad"); update(); };
  el.hex.oninput = () => {
    const h = normHex(el.hex.value);
    el.hex.classList.toggle("bad", !h);
    if (h) { el.color.value = h; update(); }
  };
  for (const x of [el.mode, el.noise, el.fTinted, el.fTransparent, el.fAnimated]) x.oninput = update;
  el.random.onclick = () => setColor("#" + Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, "0"));
  el.helpBtn.onclick = () => el.help.showModal();
  if ("EyeDropper" in window) {
    el.eyedrop.hidden = false;
    el.eyedrop.onclick = async () => {
      try { setColor((await new EyeDropper().open()).sRGBHex); } catch { /* cancelled */ }
    };
  }
  // Close dialogs when clicking the backdrop.
  for (const d of [el.help, el.report]) {
    d.addEventListener("click", e => { if (e.target === d) d.close(); });
  }
  // replaceState() in saveState doesn't fire this; only user/link navigation does.
  window.addEventListener("hashchange", () => { loadState(); buildModList(); update(); });

  loadState();
  buildModList();
  buildFooter();
  update();
})();
