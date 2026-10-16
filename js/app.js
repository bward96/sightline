/* Sightline app: screens, sheets and wiring. */
(function () {
  'use strict';
  const SL = window.SL, geo = SL.geo, EN = SL.engine, store = SL.store, chart = SL.chart;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round1 = v => Math.round(v * 10) / 10;

  store.load();
  const eng = new EN.Engine(window.SKYDATA);

  const S = {
    tab: 'tonight', dayOffset: 0, now: new Date(), nowAt: Date.now(), when: new Date(), whenFor: '',
    night: null, an: null, anKey: '', computing: false, view: 'dome', selected: null, sky: null, lim: null, hits: [],
    expand: { stars: false, dso: false, hidden: false }, mask: null, maskSig: '', maskVer: 0,
    edit: { tool: 'draw' }, drawing: null, editG: null, playing: null, armed: null, install: null, prevTheme: null
  };

  /* ---------- helpers ---------- */
  const spot = () => store.current();
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const card16 = az => COMPASS[Math.round(geo.wrap360(az) / 22.5) % 16];
  const fmtTime = d => d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: store.settings.hour24 ? 'h23' : 'h12' }) : '–';
  const fmtDay = d => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const spanText = list => list.length ? `${fmtTime(list[0][0])}–${fmtTime(list[list.length - 1][1])}` : '';
  const ico = {
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    edit: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
  };

  function toast(msg) {
    const root = $('#toastRoot'), t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    root.replaceChildren(t);
    setTimeout(() => { if (t.parentNode) t.remove(); }, 3200);
  }

  function getMask() {
    const sp = spot(), sig = sp ? sp.id + ':' + S.maskVer : '';
    if (S.maskSig !== sig || !S.mask) { S.mask = geo.buildMask(sp ? sp.strokes : []); S.maskSig = sig; }
    return S.mask;
  }
  const touchMask = () => { S.maskVer++; store.save(); };

  /* ---------- glyphs ---------- */
  function moonSVG(phase) {
    const k = Math.cos(phase * Math.PI / 180), sgn = phase < 180 ? 1 : -1, r = 9.5, pts = [];
    for (let i = 0; i <= 20; i++) { const t = (i / 20) * Math.PI; pts.push((13 + sgn * r * Math.sin(t)).toFixed(1) + ',' + (13 - r * Math.cos(t)).toFixed(1)); }
    for (let i = 20; i >= 0; i--) { const t = (i / 20) * Math.PI; pts.push((13 + sgn * k * r * Math.sin(t)).toFixed(1) + ',' + (13 - r * Math.cos(t)).toFixed(1)); }
    return `<svg class="glyph" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="9.5" fill="#1b2238" stroke="#8c96b8" stroke-width="1"/><polygon points="${pts.join(' ')}" fill="#ece8d8"/></svg>`;
  }
  function glyph(o) {
    const dso = 'var(--dso, #7fd6c9)';
    if (o.kind === 'moon') return moonSVG(S.an ? S.an.meta.moon.phase : 90);
    if (o.kind === 'planet') {
      const c = chart.BODY_COL[o.id] || '#fff';
      return `<svg class="glyph" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="6.5" fill="${c}"/>${o.id === 'Saturn' ? `<ellipse cx="13" cy="13" rx="11" ry="3.3" fill="none" stroke="${c}" stroke-width="1.4" transform="rotate(-18 13 13)"/>` : ''}</svg>`;
    }
    if (o.kind === 'star') return '<svg class="glyph" viewBox="0 0 26 26" aria-hidden="true"><path d="M13 2l2.2 8.8L24 13l-8.8 2.2L13 24l-2.2-8.8L2 13l8.8-2.2Z" fill="currentColor"/></svg>';
    const st = `fill="none" stroke="${dso}" stroke-width="1.7"`;
    let g;
    switch (o.type) {
      case 'oc': case 'sfr': g = `<circle cx="13" cy="13" r="8.5" ${st} stroke-dasharray="2.6 3"/>`; break;
      case 'gc': g = `<circle cx="13" cy="13" r="8.5" ${st}/><path d="M4.5 13h17M13 4.5v17" ${st}/>`; break;
      case 'pn': g = `<circle cx="13" cy="13" r="4.5" ${st}/><path d="M2 13h6.5M17.5 13H24M13 2v6.5M13 17.5V24" ${st}/>`; break;
      case 's': case 'e': case 'i': g = `<ellipse cx="13" cy="13" rx="10.5" ry="5" ${st} transform="rotate(-25 13 13)"/>`; break;
      default: g = `<rect x="4.5" y="4.5" width="17" height="17" rx="2" ${st}/>`;
    }
    return `<svg class="glyph" viewBox="0 0 26 26" aria-hidden="true">${g}</svg>`;
  }

  /* ---------- analysis ---------- */
  function analysisKey() {
    const sp = spot();
    return [sp.id, sp.lat, sp.lon, sp.bortle, store.settings.equip, S.dayOffset, S.maskVer, Math.floor(+S.now / 1800000)].join('|');
  }
  function ensureAnalysis(then) {
    const sp = spot();
    if (!sp) { then(); return; }
    const key = analysisKey();
    if (S.anKey === key && S.an) { then(); return; }
    S.computing = true;
    clearTimeout(S.anT);
    S.anT = setTimeout(() => {
      try {
        eng.setObserver(sp.lat, sp.lon);
        S.night = eng.night(S.now, S.dayOffset);
        S.an = eng.analyze({ start: S.night.start, end: S.night.end, bortle: sp.bortle, equip: store.settings.equip, mask: getMask() });
        const wf = sp.id + '|' + S.dayOffset;
        if (S.whenFor !== wf || +S.when < +S.night.start || +S.when > +S.night.end) {
          S.whenFor = wf;
          const n = S.night.start, e = S.night.end;
          S.when = (S.dayOffset === 0 && +S.now >= +n && +S.now <= +e) ? new Date(S.now) : (S.night.duskA && S.night.duskA < e ? new Date(S.night.duskA) : new Date(+n + 2 * 3600e3));
        }
        S.anKey = key; S.err = null;
      } catch (e) { console.error(e); S.err = e; S.an = null; }
      S.computing = false;
      then();
    }, 20);
  }
  function refresh() {
    if (S.tab === 'horizon' || !spot()) { renderTab(); return; }
    ensureAnalysis(renderTab);
    if (S.computing) renderTab();
  }

  /* ---------- views ---------- */
  function setTab(t) {
    S.tab = t; stopPlay();
    refresh();
  }
  function renderTab() {
    $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + S.tab; });
    $$('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
    if (S.tab === 'tonight') renderTonight();
    else if (S.tab === 'sky') renderSky();
    else renderHorizon();
  }
  function renderHeader() {
    const sp = spot();
    $('#spotName').textContent = sp ? sp.name : 'Set up';
    $('#nightBtn').setAttribute('aria-pressed', String(store.settings.theme === 'red'));
  }

  const welcomeHTML = () => `
    <div class="card" style="display:flex;flex-direction:column;gap:14px">
      <h1 style="font:600 28px/1.15 var(--font-display)">See the sky you actually have</h1>
      <p>Trees, fences and rooftops hide parts of the sky. Sightline maps yours, then tells you which planets, stars and deep-sky objects you can really see from that spot, and when.</p>
      <ol class="steps"><li><b>Name your spot</b> and say how dark the sky is.</li><li><b>Trace your horizon</b> with the phone camera, a photo, or your finger.</li><li><b>Check tonight</b> for what is up, and when it clears your obstructions.</li></ol>
      <button class="btn primary" data-act="newSpot">Set up my first spot</button>
    </div>`;

  /* ----- Tonight ----- */
  function headHTML() {
    const sp = spot(), d = S.night ? S.night.start : S.now;
    const title = S.dayOffset === 0 ? 'Tonight' : S.dayOffset === 1 ? 'Tomorrow night' : fmtDay(d);
    return `<div class="view-head"><div><h1>${title}</h1><p class="sub">${esc(fmtDay(d))} · ${esc(sp.name)}</p></div>
      <div class="navs"><button class="nav-btn" data-act="prevDay" aria-label="Previous night" ${S.dayOffset <= -3 ? 'disabled' : ''}>${ico.left}</button><button class="nav-btn" data-act="nextDay" aria-label="Next night" ${S.dayOffset >= 60 ? 'disabled' : ''}>${ico.right}</button></div></div>`;
  }

  function barHTML(o) {
    const n = S.night, a = +n.start, span = +n.end - a;
    const seg = (list, cls) => list.map(w => `<i class="${cls}" style="left:${((+w[0] - a) / span * 100).toFixed(2)}%;width:${Math.max(0.8, (+w[1] - +w[0]) / span * 100).toFixed(2)}%"></i>`).join('');
    let tick = '';
    if (S.dayOffset === 0 && +S.now >= a && +S.now <= +n.end) tick = `<i class="now" style="left:${((+S.now - a) / span * 100).toFixed(2)}%"></i>`;
    return `<span class="bar" aria-hidden="true">${seg(o.clear, 'c')}${seg(o.vis, 'v')}${tick}</span>`;
  }
  function rowHTML(o) {
    const blocked = o.status === 'blocked';
    const when = blocked ? spanText(o.clear) : spanText(o.vis);
    const small = blocked ? `behind ${Math.round(o.maskPeak)}° at ${card16(o.peak.az)}` : `peak ${Math.round(o.peak.alt)}° ${card16(o.peak.az)}`;
    return `<button class="obj${blocked ? ' blocked' : ''}" data-key="${esc(o.key)}">
      ${glyph(o)}<span style="min-width:0"><span class="obj-name">${esc(o.name)}</span><span class="obj-sub">${esc(o.sub)}</span></span>
      <span class="obj-when"><b>${when}</b><small>${small}</small></span>${barHTML(o)}</button>`;
  }
  function section(title, items, key, limit, emptyText) {
    const shown = S.expand[key] ? items : items.slice(0, limit);
    return `<div class="section-title"><span>${title}</span><span class="n">${items.length}</span></div>
      <div class="list">${items.length ? shown.map(rowHTML).join('') : `<div class="empty">${emptyText}</div>`}
      ${items.length > limit ? `<button class="more" data-more="${key}">${S.expand[key] ? 'Show fewer' : `Show all ${items.length}`}</button>` : ''}</div>`;
  }

  function renderTonight() {
    const el = $('#view-tonight'), sp = spot();
    if (!sp) { el.innerHTML = welcomeHTML(); return; }
    if (S.computing || !S.an) {
      el.innerHTML = headHTML() + (S.err ? `<div class="empty">Something went wrong working out the sky: ${esc(S.err.message || S.err)}</div>` : '<div class="busy">Working out the sky…</div>');
      return;
    }
    const n = S.night, an = S.an, mask = getMask(), eq = EN.EQUIP[store.settings.equip];
    const dark = n.duskA && n.dawnA ? `${fmtTime(n.duskA)}–${fmtTime(n.dawnA)}` : 'No full darkness';
    const moonParts = [];
    if (n.moonRise) moonParts.push('rises ' + fmtTime(n.moonRise));
    if (n.moonSet) moonParts.push('sets ' + fmtTime(n.moonSet));
    const vis = a => a.filter(o => o.status === 'visible'), blk = a => a.filter(o => o.status === 'blocked');
    const hidden = [].concat(blk(an.bodies), blk(an.stars), blk(an.dso)).sort((a, b) => a.eff - b.eff);
    el.innerHTML = headHTML() + `
      ${mask.coverage < 0.25 ? `<div class="notice"><p>${mask.mapped ? 'Only part of your horizon is mapped.' : 'Your horizon is not mapped yet.'} Results assume open sky where it is blank.</p><button class="btn small primary" data-act="toHorizon">Map it</button></div>` : ''}
      <dl class="card facts">
        <div><dt>Sunset</dt><dd>${fmtTime(n.sunset)}<small>sunrise ${fmtTime(n.sunrise)}</small></dd></div>
        <div><dt>Full dark</dt><dd>${dark}<small>astronomical twilight</small></dd></div>
        <div><dt>Moon</dt><dd>${Math.round(n.moon.frac * 100)}% lit<small>${esc(n.moon.name.toLowerCase())}${moonParts.length ? ' · ' + moonParts.join(' · ') : ''}</small></dd></div>
        <div><dt>Your sky</dt><dd>Bortle ${sp.bortle}<small>faintest star about ${(an.meta.base).toFixed(1)}</small></dd></div>
      </dl>
      <div class="seg" role="group" aria-label="What you are looking with">${Object.keys(EN.EQUIP).map(k => `<button data-eq="${k}" aria-pressed="${store.settings.equip === k}">${EN.EQUIP[k].label}</button>`).join('')}</div>
      ${section('Moon and planets', vis(an.bodies), 'planets', 8, 'No planets or Moon clear your horizon tonight.')}
      ${section('Bright stars', vis(an.stars), 'stars', 10, 'No bright stars clear your horizon.')}
      ${section(eq.label === 'Naked eye' ? 'Deep sky, naked eye' : 'Deep sky with ' + eq.label.toLowerCase(), vis(an.dso), 'dso', 12, 'Nothing deep-sky is bright enough from here. Try binoculars.')}
      ${hidden.length ? section('Hidden by your horizon', hidden, 'hidden', 6, '') : ''}
      <p class="muted" style="font-size:12.5px">Times are in your local time. Visibility is an estimate from your sky darkness, the Moon and the twilight. Bars run from sunset to sunrise: bright = visible, hatched = above the true horizon but behind your obstructions.</p>`;
  }

  /* ----- object sheet ----- */
  function findObject(key) {
    if (!S.an) return null;
    return [].concat(S.an.bodies, S.an.stars, S.an.dso).find(o => o.key === key) || null;
  }
  function selectionFor(o) {
    return o.kind === 'star' ? { kind: 'star', idx: o.id } : o.kind === 'dso' ? { kind: 'dso', idx: o.id } : { kind: 'body', name: o.id };
  }
  function openObject(key) {
    const o = findObject(key); if (!o) return;
    const blocked = o.status === 'blocked';
    const best = `${fmtTime(o.peak.t)} · ${Math.round(o.peak.alt)}° up toward ${card16(o.peak.az)}`;
    const rows = [
      ['Best time', best],
      [blocked ? 'Would be visible' : 'Visible', (blocked ? o.clear : o.vis).map(w => `${fmtTime(w[0])}–${fmtTime(w[1])}`).join(', ') || '–'],
      ['Magnitude', o.mag.toFixed(1) + (o.kind === 'dso' && Math.abs(o.eff - o.mag) > 0.3 ? ` (feels like ${o.eff.toFixed(1)} because it is spread out)` : '')],
      ['Your horizon there', `${Math.round(o.maskPeak)}° toward ${card16(o.peak.az)}`]
    ];
    if (blocked) rows.splice(1, 0, ['Status', 'Behind your obstructions all the time it is bright enough']);
    sheet(o.name, `<p class="muted" style="margin-top:-6px">${esc(o.sub)}</p>
      <dl class="card kv">${rows.map(r => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>
      <div class="btn-row"><button class="btn primary" id="showSky">Show in the sky</button></div>`, root => {
      $('#showSky', root).onclick = () => { S.when = new Date(o.peak.t); S.selected = selectionFor(o); closeSheet(); setTab('sky'); };
    });
  }

  /* ----- Sky ----- */
  function renderSky() {
    const el = $('#view-sky'), sp = spot();
    if (!sp) { el.innerHTML = welcomeHTML(); return; }
    if (S.computing || !S.an) { el.innerHTML = '<div class="busy">Working out the sky…</div>'; return; }
    const n = S.night, L = store.settings.layers;
    el.innerHTML = `
      <div class="seg" role="group" aria-label="Chart type"><button data-v="dome" aria-pressed="${S.view === 'dome'}">Dome</button><button data-v="pano" aria-pressed="${S.view === 'pano'}">Panorama</button></div>
      <div class="chart-wrap" id="chartWrap"><div id="chartHost" class="${S.view === 'pano' ? 'pano-scroll' : ''}"><canvas id="skyCanvas" aria-label="Sky chart"></canvas></div></div>
      <div class="card" style="display:flex;flex-direction:column;gap:10px">
        <div class="time-row"><button class="btn small" data-t="-60" aria-label="One hour earlier">−1h</button><span class="time-label" id="timeLabel" style="flex:1"></span><button class="btn small" data-act="play" id="playBtn">Play</button><button class="btn small" data-t="60" aria-label="One hour later">+1h</button></div>
        <input type="range" id="timeRange" min="${+n.start}" max="${+n.end}" step="60000" value="${+S.when}" aria-label="Time of night">
      </div>
      <div class="chips" id="layerChips">
        <button class="chip" data-layer="lines" aria-pressed="${L.lines}">Constellations</button>
        <button class="chip" data-layer="labels" aria-pressed="${L.labels}">Names</button>
        <button class="chip" data-layer="dso" aria-pressed="${L.dso}">Deep sky</button>
        <button class="chip" data-layer="mw" aria-pressed="${L.mw}">Milky Way</button>
      </div>
      <div id="selCard"></div>
      <p class="muted" id="skyNote" style="font-size:12.5px"></p>`;
    drawSky(true);
  }

  let skyRaf = 0;
  function queueSky() { if (!skyRaf) skyRaf = requestAnimationFrame(() => { skyRaf = 0; drawSky(); }); }

  function drawSky(first) {
    const canvas = $('#skyCanvas'), sp = spot();
    if (!canvas || !sp || !S.night) return;
    eng.setObserver(sp.lat, sp.lon);
    const L = store.settings.layers, frame = eng.frame(S.when);
    const sky = eng.sky(frame, { lines: L.lines, mw: L.mw && S.view === 'dome', cons: L.labels && L.lines, bodies: true });
    const lim = eng.chartLimit(frame, sp.bortle, store.settings.equip, sky.bodies);
    const scene = { sky, lim, mask: getMask(), layers: L, selected: S.selected, eng };
    let res;
    if (S.view === 'dome') res = chart.drawDome(canvas, scene);
    else {
      res = chart.drawPano(canvas, scene, { ppdX: 3, ppdY: 3, altMax: 90 });
      const sc = $('#chartHost');
      if (first) {
        let az = 180;
        if (S.selected) { const p = selectedPos(sky); if (p) az = p.az; }
        sc.scrollLeft = az * 3 - sc.clientWidth / 2;
      }
    }
    S.hits = res.hits; S.sky = sky; S.lim = lim;
    $('#timeLabel').textContent = fmtTime(S.when);
    $('#timeRange').value = String(+S.when);
    renderSel();
    const notes = [`Showing stars to magnitude ${Math.max(lim.limit, 0).toFixed(1)}.`];
    if (lim.sunAlt > -0.83) notes.push('The Sun is up, so no stars are visible.');
    else if (lim.sunAlt > -18) notes.push('Twilight is hiding the fainter stars.');
    if (lim.moon.alt > 0 && lim.moon.frac > 0.3) notes.push('The Moon is up and washing out faint objects.');
    $('#skyNote').textContent = notes.join(' ');
  }

  function selectedPos(sky) {
    const s = S.selected; if (!s || !sky) return null;
    if (s.kind === 'star') return { az: sky.stars.az[s.idx], alt: sky.stars.alt[s.idx] };
    if (s.kind === 'dso') return { az: sky.dso.az[s.idx], alt: sky.dso.alt[s.idx] };
    const b = sky.bodies.find(x => x.name === s.name); return b ? { az: b.az, alt: b.alt } : null;
  }
  function selectedInfo() {
    const s = S.selected; if (!s || !S.sky) return null;
    const p = selectedPos(S.sky); if (!p) return null;
    let name, sub;
    if (s.kind === 'star') { name = eng.sname[s.idx] || 'Star'; sub = 'Star · mag ' + eng.smag[s.idx].toFixed(1); }
    else if (s.kind === 'dso') { const o = eng.dso[s.idx]; name = o.n ? `${o.id} · ${o.n}` : o.id; sub = `${EN.DSO_TYPES[o.t] || 'Deep-sky object'} · mag ${o.m.toFixed(1)}`; }
    else { name = s.name; const b = S.sky.bodies.find(x => x.name === s.name); sub = s.name === 'Sun' ? 'Sun' : s.name === 'Moon' ? `${Math.round(S.lim.moonInfo.frac * 100)}% lit` : 'Planet · mag ' + b.mag.toFixed(1); }
    const m = geo.maskAt(getMask(), p.az);
    let status = 'Below the horizon';
    if (p.alt > 0) status = p.alt >= m ? 'Clear of your horizon' : `Hidden behind ${Math.round(m)}° obstruction`;
    return { name, sub, p, status, key: s.kind === 'star' ? 's:' + s.idx : s.kind === 'dso' ? 'd:' + s.idx : 'b:' + s.name };
  }
  function renderSel() {
    const el = $('#selCard'); if (!el) return;
    const i = selectedInfo();
    if (!i) { el.innerHTML = '<p class="muted" style="font-size:13px">Tap a star, planet or deep-sky symbol to see where it is and whether your horizon hides it.</p>'; return; }
    const inList = !!findObject(i.key);
    el.innerHTML = `<div class="card sel-card"><div style="min-width:0"><div class="t">${esc(i.name)}</div><div class="muted" style="font-size:13px">${esc(i.sub)} · ${Math.round(i.p.alt)}° up, ${card16(i.p.az)}</div><div style="font-size:13px;color:${i.status.startsWith('Clear') ? 'var(--good)' : 'var(--warn)'}">${i.status}</div></div>${inList ? '<button class="btn small" data-act="details">Details</button>' : ''}</div>`;
  }

  function stopPlay() { if (S.playing) { clearInterval(S.playing); S.playing = null; const b = $('#playBtn'); if (b) b.textContent = 'Play'; } }
  function togglePlay() {
    if (S.playing) { stopPlay(); return; }
    $('#playBtn').textContent = 'Pause';
    if (+S.when >= +S.night.end - 60000) S.when = new Date(S.night.start);
    S.playing = setInterval(() => {
      S.when = new Date(+S.when + 4 * 60000);
      if (+S.when >= +S.night.end) { S.when = new Date(S.night.end); stopPlay(); }
      queueSky();
    }, 90);
  }

  /* ----- Horizon ----- */
  function renderHorizon() {
    const el = $('#view-horizon'), sp = spot();
    if (!sp) { el.innerHTML = welcomeHTML(); return; }
    const m = getMask(), pct = Math.round(m.coverage * 100), c = sp.calib;
    const canCam = SL.capture.supported() && window.isSecureContext;
    const circ = 2 * Math.PI * 30;
    el.innerHTML = `
      <div class="view-head"><div><h1>Your horizon</h1><p class="sub">${esc(sp.name)} · what blocks the sky</p></div></div>
      <div class="card cover">
        <svg class="ring" viewBox="0 0 72 72" role="img" aria-label="${pct}% of directions mapped"><circle cx="36" cy="36" r="30" fill="none" stroke="var(--surface-2)" stroke-width="8"/><circle cx="36" cy="36" r="30" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(m.coverage * circ).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 36 36)"/><text x="36" y="41" text-anchor="middle">${pct}%</text></svg>
        <div><b>${m.mapped ? `${pct}% of directions mapped` : 'Nothing mapped yet'}</b><p class="muted" style="font-size:14px">${m.mapped ? `Tallest obstruction ${Math.round(m.max)}° high.` : 'Until you trace it, results assume a flat, open horizon.'}</p></div>
      </div>
      ${canCam ? `<div class="btn-row"><button class="btn primary" data-cap="${c.at ? 'trace' : 'align'}">Trace with camera</button><button class="btn" data-cap="photo">Trace from a photo</button></div>
        <div class="card" style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div style="min-width:0"><b>Compass</b><p class="muted" style="font-size:13.5px">${c.at ? `Corrected by ${c.azOff >= 0 ? '+' : '−'}${Math.abs(c.azOff).toFixed(1)}° using ${esc(c.target || 'a target')}.` : 'Not aligned. Phone compasses are often 10–20° off, so align on the Sun, Moon or a bright star first.'}</p></div><button class="btn small" data-cap="align">${c.at ? 'Re-align' : 'Align'}</button></div>
          <div class="field"><label for="calOff">Or type a correction (degrees)</label><input id="calOff" type="number" step="0.5" min="-90" max="90" inputmode="decimal" value="${c.azOff.toFixed(1)}"></div>
        </div>`
        : `<div class="notice"><p>Camera tracing needs a phone with motion sensors and a secure (https) page. You can still draw your horizon by hand below.</p></div>`}
      <div class="section-title"><span>Draw or adjust</span><span class="n mono">0–60°</span></div>
      <div class="chart-wrap" id="editWrap" style="touch-action:none"><canvas id="editCanvas" aria-label="Horizon editor. Drag to draw the skyline."></canvas></div>
      <div class="editor-tools">
        <div class="seg" style="flex:1 1 180px" role="group" aria-label="Drawing tool"><button data-tool="draw" aria-pressed="${S.edit.tool === 'draw'}">Draw skyline</button><button data-tool="erase" aria-pressed="${S.edit.tool === 'erase'}">Open sky</button></div>
        <button class="btn small" data-act="undo" ${sp.strokes.length ? '' : 'disabled'}>Undo</button>
        <button class="btn small danger" data-act="clear" ${sp.strokes.length ? '' : 'disabled'}>${S.armed === 'clear' ? 'Tap again to clear' : 'Clear'}</button>
      </div>
      <p class="muted" style="font-size:13px">Drag along the top edge of what blocks you. Where nothing blocks the sky, drag along the bottom with Open sky. North is at both ends; east is left of south.</p>
      <div class="section-title"><span>Tips</span></div>
      <ol class="steps"><li><b>Stand where you observe</b>, not where you stand when it is convenient.</li><li><b>Align the compass</b> on the Sun, Moon or a bright star. It takes ten seconds and fixes most of the error.</li><li><b>Trace the top edge</b> of trees, fences and roofs. Branches thin out in winter, so trace what blocks you most.</li><li>Trace again in another season if a tree changes a lot.</li></ol>`;
    drawEditor();
  }

  function drawEditor(preview) {
    const cv = $('#editCanvas'), sp = spot(); if (!cv || !sp) return;
    const w = Math.max(280, Math.floor(cv.parentElement.clientWidth));
    const mask = preview ? geo.buildMask(sp.strokes.concat([{ pts: preview }])) : getMask();
    const res = chart.drawPano(cv, { mask, sky: null, editing: true }, { ppdX: w / 360, ppdY: 4, altMax: 60 });
    S.editG = res.geom;
    if (!cv.dataset.bound) {
      cv.dataset.bound = '1';
      const pt = e => { const r = cv.getBoundingClientRect(), a = S.editG.toAzAlt(e.clientX - r.left, e.clientY - r.top); return [round1(a.az), S.edit.tool === 'erase' ? 0 : round1(a.alt)]; };
      cv.onpointerdown = e => { S.drawing = [pt(e)]; try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } drawEditor(S.drawing); };
      cv.onpointermove = e => {
        if (!S.drawing) return;
        const p = pt(e), l = S.drawing[S.drawing.length - 1];
        if (Math.abs(p[0] - l[0]) < 0.4 && Math.abs(p[1] - l[1]) < 0.4) return;
        S.drawing.push(p); drawEditor(S.drawing);
      };
      cv.onpointerup = cv.onpointercancel = () => {
        if (!S.drawing) return;
        const pts = S.drawing; S.drawing = null;
        spot().strokes.push({ kind: 'draw', t: Date.now(), pts }); touchMask(); renderHorizon();
      };
    }
  }

  /* ---------- sheets ---------- */
  function sheet(title, html, mount) {
    const root = $('#sheetRoot');
    root.innerHTML = `<div class="backdrop" id="bd"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" id="shClose" aria-label="Close">${ico.x}</button></div><div class="sheet-body">${html}</div></div></div>`;
    $('#bd').onclick = e => { if (e.target.id === 'bd') closeSheet(); };
    $('#shClose').onclick = closeSheet;
    if (mount) mount($('.sheet-body', root));
    $('#shClose').focus();
  }
  function closeSheet() { $('#sheetRoot').innerHTML = ''; }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#sheetRoot').firstChild) closeSheet(); });

  function spotsSheet() {
    const list = store.state.spots.map(s => {
      const cov = Math.round(geo.buildMask(s.strokes).coverage * 100);
      return `<div class="spot-row"><button class="pick" data-id="${esc(s.id)}" aria-pressed="${s.id === store.state.current}"><span class="spot-dot"></span><span style="min-width:0"><strong>${esc(s.name)}</strong><small>${cov}% mapped · Bortle ${s.bortle}</small></span></button><button class="icon-btn" data-edit="${esc(s.id)}" aria-label="Edit ${esc(s.name)}">${ico.edit}</button></div>`;
    }).join('');
    sheet('Your spots', `${list || '<p class="muted">No spots yet.</p>'}<button class="btn" id="addSpot">Add another spot</button>
      <p class="muted" style="font-size:13px">A spot is a place you observe from, like the back garden or front yard. Each keeps its own horizon.</p>`, root => {
      root.onclick = e => {
        const pick = e.target.closest('.pick'), ed = e.target.closest('[data-edit]');
        if (pick) { store.setCurrent(pick.dataset.id); S.anKey = ''; S.maskSig = ''; closeSheet(); renderHeader(); refresh(); }
        else if (ed) spotForm(store.state.spots.find(s => s.id === ed.dataset.edit));
        else if (e.target.id === 'addSpot') spotForm(null);
      };
    });
  }

  function spotForm(existing) {
    const s = existing || { name: store.state.spots.length ? 'Front yard' : 'Back garden', lat: '', lon: '', bortle: 6 };
    sheet(existing ? 'Edit spot' : 'New spot', `
      <div class="field"><label for="fName">Name</label><input id="fName" type="text" maxlength="40" value="${esc(s.name)}" autocomplete="off"></div>
      <div class="field"><span class="label">Location</span>
        <div class="two"><input id="fLat" type="number" step="0.0001" inputmode="decimal" placeholder="Latitude" aria-label="Latitude" value="${esc(s.lat)}"><input id="fLon" type="number" step="0.0001" inputmode="decimal" placeholder="Longitude" aria-label="Longitude" value="${esc(s.lon)}"></div>
        <button class="btn small" id="fGeo" type="button">Use my location</button><p class="muted" id="fMsg" style="font-size:13px"></p></div>
      <div class="field"><label for="fBortle">Sky darkness (Bortle scale)</label>
        <select id="fBortle">${EN.BORTLE_TEXT.map((t, i) => `<option value="${i + 1}" ${s.bortle === i + 1 ? 'selected' : ''}>${i + 1} · ${t}</option>`).join('')}</select>
        <p class="muted" style="font-size:13px">Not sure? Suburbs of a big town are usually 6 or 7, villages 4 or 5, city centres 8 or 9. You can change it later.</p></div>
      <div class="btn-row"><button class="btn primary" id="fSave">Save</button>${existing && store.state.spots.length > 1 ? '<button class="btn danger" id="fDel">Delete spot</button>' : ''}</div>`, root => {
      const msg = t => { $('#fMsg', root).textContent = t; };
      $('#fGeo', root).onclick = () => {
        if (!navigator.geolocation) return msg('Location is not available in this browser. Type the coordinates instead.');
        msg('Finding you…');
        navigator.geolocation.getCurrentPosition(p => {
          $('#fLat', root).value = p.coords.latitude.toFixed(4); $('#fLon', root).value = p.coords.longitude.toFixed(4); msg('Location set.');
        }, () => msg('Could not get your location. Allow location access, or type the coordinates.'), { timeout: 12000, maximumAge: 600000 });
      };
      $('#fSave', root).onclick = () => {
        const lat = parseFloat($('#fLat', root).value), lon = parseFloat($('#fLon', root).value), name = $('#fName', root).value.trim() || 'My spot';
        if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180) || isNaN(lat) || isNaN(lon)) return msg('Enter a latitude and longitude, or tap Use my location.');
        const bortle = +$('#fBortle', root).value;
        if (existing) { Object.assign(existing, { name, lat, lon, bortle }); store.setCurrent(existing.id); store.save(); toast('Spot saved.'); closeSheet(); S.anKey = ''; renderHeader(); refresh(); }
        else {
          store.addSpot({ name, lat, lon, bortle }); S.anKey = ''; S.maskSig = ''; S.maskVer++; closeSheet(); renderHeader();
          toast('Spot created. Now map your horizon.'); S.tab = 'horizon'; refresh();
        }
      };
      const del = $('#fDel', root);
      if (del) del.onclick = () => {
        if (S.armed !== 'delSpot') { S.armed = 'delSpot'; del.textContent = 'Tap again to delete'; return; }
        S.armed = null; store.removeSpot(existing.id); S.anKey = ''; S.maskSig = ''; closeSheet(); renderHeader(); refresh();
      };
    });
  }

  function appSheet() {
    const st = store.settings;
    sheet('Settings', `
      <div class="field"><span class="label">Colours</span><div class="seg" id="themeSeg">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark'], ['red', 'Night red']].map(t => `<button data-theme="${t[0]}" aria-pressed="${st.theme === t[0]}">${t[1]}</button>`).join('')}</div>
        <p class="muted" style="font-size:13px">Night red keeps your eyes dark-adapted outside.</p></div>
      <div class="field"><span class="label">Clock</span><div class="seg" id="clockSeg"><button data-h="1" aria-pressed="${st.hour24}">24-hour</button><button data-h="0" aria-pressed="${!st.hour24}">12-hour</button></div></div>
      <div class="field"><span class="label">Backup</span>
        <p class="muted" style="font-size:13px">Everything is stored on this phone only. Save a backup before clearing browser data or changing phones.</p>
        <div class="btn-row"><button class="btn" id="bkSave">Download backup</button><button class="btn" id="bkCopy">Copy backup</button><button class="btn" id="bkLoad">Restore backup</button></div>
        <input type="file" id="bkFile" accept="application/json,.json" hidden></div>
      ${S.install ? '<button class="btn primary" id="installBtn">Install Sightline on this phone</button>' : ''}
      <details class="card"><summary style="cursor:pointer;font-weight:600">About and data sources</summary>
        <p class="muted" style="font-size:13.5px;margin-top:8px">Positions come from astronomy-engine (MIT). Stars, constellations and deep-sky objects come from the d3-celestial catalogues (BSD-3), built on Hipparcos, Messier, NGC and IC data. Visibility is an estimate: it uses your Bortle class, twilight, Moon glare, air mass and each object's size and brightness. It is a guide, not a guarantee.</p></details>
      <button class="btn danger" id="wipe">${S.armed === 'wipe' ? 'Tap again to erase everything' : 'Erase all data on this phone'}</button>`, root => {
      root.onclick = e => {
        const th = e.target.closest('[data-theme]'), ck = e.target.closest('[data-h]');
        if (th) { st.theme = th.dataset.theme; store.save(); applyTheme(); appSheet(); }
        else if (ck) { st.hour24 = ck.dataset.h === '1'; store.save(); appSheet(); refresh(); }
      };
      $('#bkSave', root).onclick = () => {
        if (window.SightlineAndroid) { window.SightlineAndroid.saveText('sightline-backup.json', store.exportText()); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([store.exportText()], { type: 'application/json' }));
        a.download = 'sightline-backup.json'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      };
      $('#bkCopy', root).onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(store.exportText()) : Promise.reject()).then(() => toast('Backup copied.'), () => toast('Could not copy. Use Download backup.')); };
      $('#bkLoad', root).onclick = () => $('#bkFile', root).click();
      $('#bkFile', root).onchange = ev => {
        const f = ev.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => { try { const n = store.importText(String(r.result)); S.anKey = ''; S.maskSig = ''; closeSheet(); renderHeader(); refresh(); toast(`Restored ${n} spot${n === 1 ? '' : 's'}.`); } catch (err) { toast(err.message || 'Could not read that file.'); } };
        r.readAsText(f);
      };
      const ib = $('#installBtn', root);
      if (ib) ib.onclick = () => { S.install.prompt(); S.install = null; closeSheet(); };
      $('#wipe', root).onclick = () => {
        if (S.armed !== 'wipe') { S.armed = 'wipe'; $('#wipe', root).textContent = 'Tap again to erase everything'; return; }
        S.armed = null; store.reset(); store.load(); S.anKey = ''; S.maskSig = ''; S.an = null; closeSheet(); applyTheme(); renderHeader(); refresh();
      };
    });
  }

  /* ---------- theme ---------- */
  function applyTheme() {
    const t = store.settings.theme, root = document.documentElement;
    if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    const color = getComputedStyle(root).getPropertyValue('--bg').trim();
    const m = $('meta[name="theme-color"]'); if (m && color) m.setAttribute('content', color);
    $('#nightBtn').setAttribute('aria-pressed', String(t === 'red'));
    if (S.tab === 'sky') queueSky(); else if (S.tab === 'horizon') drawEditor();
  }

  /* ---------- camera ---------- */
  function startCapture(mode) {
    const sp = spot(); if (!sp) return;
    if (!SL.capture.supported() || !window.isSecureContext) return toast('Camera and motion sensors need a phone and an https page.');
    eng.setObserver(sp.lat, sp.lon);
    SL.capture.open({
      spot: sp, eng, settings: store.settings, mode, toast, getMask,
      onStroke: s => { sp.strokes.push(s); touchMask(); },
      onCalib: c => { sp.calib = c; store.save(); },
      onFnorm: f => { store.settings.fnorm = f; store.save(); },
      onClose: () => { renderTab(); }
    });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', e => {
    const t = e.target;
    const tab = t.closest('.tab'); if (tab) { setTab(tab.dataset.tab); return; }
    if (t.closest('#spotBtn')) { store.state.spots.length ? spotsSheet() : spotForm(null); return; }
    if (t.closest('#menuBtn')) { appSheet(); return; }
    if (t.closest('#nightBtn')) {
      const st = store.settings;
      if (st.theme === 'red') st.theme = S.prevTheme || 'auto'; else { S.prevTheme = st.theme; st.theme = 'red'; }
      store.save(); applyTheme(); renderHeader(); return;
    }
    const main = t.closest('main'); if (!main) return;
    const obj = t.closest('.obj'); if (obj) { openObject(obj.dataset.key); return; }
    const more = t.closest('[data-more]'); if (more) { S.expand[more.dataset.more] = !S.expand[more.dataset.more]; renderTonight(); return; }
    const eq = t.closest('[data-eq]'); if (eq) { store.settings.equip = eq.dataset.eq; store.save(); S.anKey = ''; refresh(); return; }
    const act = t.closest('[data-act]');
    if (act) {
      switch (act.dataset.act) {
        case 'newSpot': spotForm(null); break;
        case 'toHorizon': setTab('horizon'); break;
        case 'prevDay': S.dayOffset--; S.anKey = ''; refresh(); break;
        case 'nextDay': S.dayOffset++; S.anKey = ''; refresh(); break;
        case 'play': togglePlay(); break;
        case 'details': { const i = selectedInfo(); if (i) openObject(i.key); break; }
        case 'undo': spot().strokes.pop(); touchMask(); S.armed = null; renderHorizon(); break;
        case 'clear':
          if (S.armed !== 'clear') { S.armed = 'clear'; renderHorizon(); break; }
          S.armed = null; spot().strokes = []; touchMask(); renderHorizon(); break;
      }
      return;
    }
    const v = t.closest('[data-v]'); if (v) { S.view = v.dataset.v; renderSky(); return; }
    const tm = t.closest('[data-t]'); if (tm) { stopPlay(); S.when = new Date(Math.min(+S.night.end, Math.max(+S.night.start, +S.when + (+tm.dataset.t) * 60000))); queueSky(); return; }
    const ly = t.closest('[data-layer]'); if (ly) { const L = store.settings.layers; L[ly.dataset.layer] = !L[ly.dataset.layer]; store.save(); ly.setAttribute('aria-pressed', String(L[ly.dataset.layer])); queueSky(); return; }
    const tool = t.closest('[data-tool]'); if (tool) { S.edit.tool = tool.dataset.tool; $$('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b === tool))); return; }
    const cap = t.closest('[data-cap]'); if (cap) { startCapture(cap.dataset.cap); return; }
    const cv = t.closest('#skyCanvas');
    if (cv) {
      const r = cv.getBoundingClientRect(), h = chart.hit(S.hits, e.clientX - r.left, e.clientY - r.top);
      S.selected = h ? (h.kind === 'body' ? { kind: 'body', name: h.name } : { kind: h.kind, idx: h.idx }) : null;
      drawSky();
    }
  });
  document.addEventListener('change', e => {
    if (e.target.id !== 'calOff' || !spot()) return;
    const v = parseFloat(e.target.value);
    if (!isFinite(v)) return;
    const sp = spot();
    sp.calib = { azOff: geo.wrap180(v), altOff: sp.calib.altOff || 0, at: Date.now(), target: 'your typed value' };
    store.save(); renderHorizon();
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'timeRange') { stopPlay(); S.when = new Date(+e.target.value); queueSky(); }
  });

  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (S.tab === 'sky' && S.an) drawSky(); else if (S.tab === 'horizon') drawEditor(); }, 120);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - S.nowAt > 20 * 60000) { S.now = new Date(); S.nowAt = Date.now(); S.anKey = ''; if (S.tab !== 'horizon') refresh(); }
  });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.install = e; });

  /* ---------- start ---------- */
  applyTheme();
  renderHeader();
  refresh();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.SightlineAndroid) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  }
  window.SLApp = { S, refresh, setTab, eng };
})();
