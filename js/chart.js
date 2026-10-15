/* Sightline charts: zenith-centred dome and scrolling panorama, both with your horizon drawn as the ground. */
(function (root) {
  'use strict';
  const geo = root.SL.geo;
  const { D2R, clamp, maskAt } = geo;
  const TAU = Math.PI * 2;

  const BODY_COL = {
    Sun: '#ffd66b', Moon: '#ece8d8', Mercury: '#c9c3b8', Venus: '#fff0c0', Mars: '#ff8a5c',
    Jupiter: '#f4dcb0', Saturn: '#e8cd8e', Uranus: '#9fe6ea', Neptune: '#8fa8ff'
  };
  const cardinals = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
  const eighths = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315], ['N', 360]];

  function palette() {
    const cs = getComputedStyle(document.documentElement);
    const g = n => cs.getPropertyValue(n).trim();
    const mono = g('--chart-mono') === '1';
    return {
      skyTop: g('--chart-sky-top'), skyBot: g('--chart-sky-bot'), ground: g('--chart-ground'), edge: g('--chart-ground-edge'),
      line: g('--chart-line'), label: g('--chart-label'), grid: g('--chart-grid'), star: g('--chart-star'),
      mw: g('--chart-mw') || '150,175,255', mono, accent: g('--accent'), dso: mono ? g('--chart-star') : '#7fd6c9'
    };
  }

  function bvColor(bv) {
    const s = [[-0.3, [165, 195, 255]], [0.1, [210, 225, 255]], [0.4, [255, 250, 240]], [0.8, [255, 232, 190]], [1.3, [255, 200, 150]], [2.0, [255, 170, 120]]];
    if (bv <= s[0][0]) return `rgb(${s[0][1]})`;
    for (let i = 1; i < s.length; i++) {
      if (bv <= s[i][0]) {
        const t = (bv - s[i - 1][0]) / (s[i][0] - s[i - 1][0]), a = s[i - 1][1], b = s[i][1];
        return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
      }
    }
    return `rgb(${s[s.length - 1][1]})`;
  }
  const starRadius = mag => clamp(0.5 + (6.5 - mag) * 0.38, 0.5, 5.2);

  function setupCanvas(canvas, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function makeLabeler(ctx, W, H, pal) {
    const rects = [];
    return function (text, x, y, opts) {
      opts = opts || {};
      ctx.font = opts.font || '11px system-ui, sans-serif';
      ctx.fillStyle = opts.color || pal.label;
      const w = ctx.measureText(text).width, h = 11;
      const cand = [[x + 7, y + 4], [x - 7 - w, y + 4], [x - w / 2, y - 8], [x - w / 2, y + 17]];
      for (const c of cand) {
        const r = { x: c[0] - 2, y: c[1] - h, w: w + 4, h: h + 3 };
        if (r.x < 2 || r.y < 2 || r.x + r.w > W - 2 || r.y + r.h > H - 2) continue;
        if (rects.some(o => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y)) continue;
        rects.push(r);
        ctx.fillText(text, c[0], c[1]);
        return true;
      }
      return false;
    };
  }

  function drawMoon(ctx, x, y, r, phaseDeg, pal) {
    const k = Math.cos(phaseDeg * D2R), waxing = phaseDeg < 180, sgn = waxing ? 1 : -1;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = pal.mono ? '#2a0806' : '#1b2238'; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const t = (i / 24) * Math.PI; ctx.lineTo(x + sgn * r * Math.sin(t), y - r * Math.cos(t)); }
    for (let i = 24; i >= 0; i--) { const t = (i / 24) * Math.PI; ctx.lineTo(x + sgn * k * r * Math.sin(t), y - r * Math.cos(t)); }
    ctx.closePath();
    ctx.fillStyle = pal.mono ? '#ff7a6a' : BODY_COL.Moon; ctx.fill();
    ctx.strokeStyle = pal.mono ? '#7a2018' : '#8c96b8'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  function dsoGlyph(ctx, x, y, r, type, col) {
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.95;
    switch (type) {
      case 'oc': case 'sfr': ctx.setLineDash([2, 2.2]); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); break;
      case 'gc':
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke(); break;
      case 'pn':
        ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x - r * 0.55, y); ctx.moveTo(x + r * 0.55, y); ctx.lineTo(x + r, y);
        ctx.moveTo(x, y - r); ctx.lineTo(x, y - r * 0.55); ctx.moveTo(x, y + r * 0.55); ctx.lineTo(x, y + r); ctx.stroke(); break;
      case 's': case 'e': case 'i':
        ctx.beginPath(); ctx.ellipse(x, y, r * 1.25, r * 0.6, -0.35, 0, TAU); ctx.stroke(); break;
      default: ctx.strokeRect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
    }
    ctx.restore();
  }

  /* One renderer for both layouts. g.xy(az, alt) -> [x, y]; g.visible(alt) filters what is on screen. */
  function paintObjects(ctx, g, scene, pal, hits) {
    const sky = scene.sky, lim = scene.lim.limit, layers = scene.layers, eng = scene.eng;
    const W = g.W, H = g.H;
    const label = makeLabeler(ctx, W, H, pal);
    const showLabels = layers.labels;

    // constellation lines
    if (layers.lines && sky.lines) {
      ctx.strokeStyle = pal.line; ctx.lineWidth = 1; ctx.beginPath();
      for (const c of sky.lines) for (const seg of c.segs) {
        for (let i = 0; i < seg.az.length - 1; i++) {
          const a1 = seg.alt[i], a2 = seg.alt[i + 1];
          if (a1 < -2 && a2 < -2) continue;
          if (g.wrap && Math.abs(seg.az[i] - seg.az[i + 1]) > 180) continue;
          const p = g.xy(seg.az[i], a1), q = g.xy(seg.az[i + 1], a2);
          ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
        }
      }
      ctx.stroke();
    }

    // deep-sky objects
    const dsoItems = [];
    if (layers.dso) {
      const d = eng.dso;
      for (let i = 0; i < d.length; i++) {
        const alt = sky.dso.alt[i];
        if (alt < 0.5 || d[i].eff > lim + 0.3) continue;
        const p = g.xy(sky.dso.az[i], alt);
        const r = clamp(3.2 + Math.log10(1 + (d[i].d[0] || 1)) * 2.1, 4, 10);
        dsoGlyph(ctx, p[0], p[1], r, d[i].t, pal.dso);
        dsoItems.push({ i, x: p[0], y: p[1] });
        hits.push({ x: p[0], y: p[1], r: Math.max(r, 9), kind: 'dso', idx: i, pri: 2 });
      }
    }

    // stars
    const n = eng.nStars, mags = eng.smag;
    const named = [];
    for (let i = 0; i < n; i++) {
      const mag = mags[i];
      if (mag > lim) continue;
      const alt = sky.stars.alt[i];
      if (alt < 0.2) continue;
      const p = g.xy(sky.stars.az[i], alt);
      const r = starRadius(mag);
      const col = pal.mono ? pal.star : bvColor(eng.sbv[i]);
      if (mag < 1.6) {
        ctx.globalAlpha = 0.18; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p[0], p[1], r * 2.4, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill();
      if (eng.sproper[i] && mag <= g.labelMag) named.push({ i, x: p[0], y: p[1], mag });
      if (mag <= 4.2 || eng.sproper[i]) hits.push({ x: p[0], y: p[1], r: Math.max(r, 8), kind: 'star', idx: i, pri: 1 });
    }

    // bodies
    const bodies = sky.bodies || [];
    const bodyPts = [];
    for (const b of bodies) {
      if (b.alt < -0.3) continue;
      if (b.name === 'Sun' && b.alt > 25 && false) continue;
      const p = g.xy(b.az, Math.max(b.alt, 0));
      const col = pal.mono ? pal.star : BODY_COL[b.name];
      if (b.name === 'Sun') {
        ctx.globalAlpha = 0.25; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p[0], p[1], 15, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p[0], p[1], 8, 0, TAU); ctx.fill();
      } else if (b.name === 'Moon') {
        drawMoon(ctx, p[0], p[1], 9, scene.lim.moonInfo.phase, pal);
      } else {
        if (b.mag > lim + 0.3) continue;
        const r = 2.4 + clamp(-b.mag, 0, 3.5) * 0.9;
        ctx.globalAlpha = 0.25; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p[0], p[1], r * 2.2, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill();
      }
      bodyPts.push({ b, x: p[0], y: p[1] });
      hits.push({ x: p[0], y: p[1], r: 14, kind: 'body', name: b.name, pri: 3 });
    }

    // labels (priority order, collision-avoiding)
    if (showLabels) {
      for (const bp of bodyPts) label(bp.b.name, bp.x, bp.y + (bp.b.name === 'Moon' ? 6 : 0), { color: pal.mono ? pal.label : '#fff', font: '600 12px system-ui, sans-serif' });
      named.sort((a, b) => a.mag - b.mag);
      for (const s of named.slice(0, 40)) label(eng.sname[s.i], s.x, s.y);
      const dsoSorted = dsoItems.sort((a, b) => eng.dso[a.i].eff - eng.dso[b.i].eff).slice(0, 26);
      for (const d of dsoSorted) {
        const o = eng.dso[d.i];
        label(/^M\d/.test(o.id) ? o.id : (o.n || o.id), d.x, d.y, { color: pal.dso, font: '10.5px system-ui, sans-serif' });
      }
      if (sky.cons) {
        ctx.save(); ctx.globalAlpha = 0.8;
        for (const c of sky.cons) if (c.alt > 6) label(c.n.toUpperCase(), ...g.xy(c.az, c.alt), { color: pal.line.replace(/[\d.]+\)$/, '0.85)'), font: 'italic 10px system-ui, sans-serif' });
        ctx.restore();
      }
    }
    // selection ring
    const sel = scene.selected;
    if (sel) {
      const h = hits.find(k => k.kind === sel.kind && (sel.kind === 'body' ? k.name === sel.name : k.idx === sel.idx));
      if (h) {
        ctx.strokeStyle = pal.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(h.x, h.y, Math.max(h.r, 12) + 3, 0, TAU); ctx.stroke();
        ctx.lineWidth = 1; ctx.globalAlpha = .4; ctx.beginPath(); ctx.arc(h.x, h.y, Math.max(h.r, 12) + 9, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
  }

  /* ---------- dome ---------- */
  function drawDome(canvas, scene) {
    const size = Math.round(canvas.parentElement.clientWidth || 360);
    const ctx = setupCanvas(canvas, size, size);
    const pal = palette(), c = size / 2, R = size / 2 - 22;
    const xy = (az, alt) => { const r = (R * (90 - alt)) / 90, a = az * D2R; return [c - r * Math.sin(a), c - r * Math.cos(a)]; };
    const g = { W: size, H: size, xy, wrap: false, labelMag: 2.6 };
    const hits = [];
    ctx.clearRect(0, 0, size, size);
    const grad = ctx.createRadialGradient(c, c, 0, c, c, R);
    grad.addColorStop(0, pal.skyTop); grad.addColorStop(1, pal.skyBot);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, R, 0, TAU); ctx.clip();

    // Milky Way (outline polygons stacked so brighter cores accumulate)
    if (scene.layers.mw && scene.sky.mw) {
      for (const level of scene.sky.mw) {
        ctx.fillStyle = `rgba(${pal.mw},0.045)`;
        for (const ring of level) {
          ctx.beginPath();
          for (let i = 0; i < ring.az.length; i++) {
            const p = xy(ring.az[i], Math.max(ring.alt[i], -15));
            if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
          }
          ctx.closePath(); ctx.fill();
        }
      }
    }
    // altitude rings
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1;
    for (const a of [30, 60]) { ctx.beginPath(); ctx.arc(c, c, (R * (90 - a)) / 90, 0, TAU); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(c, c - R); ctx.lineTo(c, c + R); ctx.moveTo(c - R, c); ctx.lineTo(c + R, c); ctx.stroke();

    paintObjects(ctx, g, scene, pal, hits);

    // ground = everything between your horizon and the rim
    ctx.beginPath();
    ctx.arc(c, c, R + 1.5, 0, TAU);
    for (let i = 0; i < 360; i++) {
      const m = scene.mask ? scene.mask.alt[i] : 0, p = xy(i, m);
      if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
    }
    ctx.closePath();
    ctx.fillStyle = pal.ground; ctx.fill('evenodd');
    ctx.strokeStyle = pal.edge; ctx.lineWidth = 1.4; ctx.beginPath();
    for (let i = 0; i <= 360; i++) {
      const m = scene.mask ? scene.mask.alt[i % 360] : 0, p = xy(i, m);
      if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
    }
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = pal.edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(c, c, R + 1.5, 0, TAU); ctx.stroke();
    ctx.fillStyle = pal.label; ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [t, az] of cardinals) { const p = xy(az, -9.5); ctx.fillText(t, p[0], p[1]); }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    return { hits, geom: g };
  }

  /* ---------- panorama ---------- */
  function panoGeom(opts) {
    const ppdX = opts.ppdX, ppdY = opts.ppdY, altMax = opts.altMax, top = 8, bottom = 22;
    const W = Math.round(360 * ppdX), H = Math.round(top + altMax * ppdY + bottom), base = top + altMax * ppdY;
    return {
      W, H, ppdX, ppdY, altMax, top, base, wrap: true, labelMag: 3.2,
      xy: (az, alt) => [az * ppdX, base - Math.min(alt, altMax + 20) * ppdY],
      toAzAlt: (x, y) => ({ az: clamp((x / ppdX), 0, 359.99), alt: clamp((base - y) / ppdY, 0, altMax) })
    };
  }

  function drawPano(canvas, scene, opts) {
    const g = panoGeom(opts);
    const ctx = setupCanvas(canvas, g.W, g.H);
    const pal = palette(), hits = [];
    const grad = ctx.createLinearGradient(0, 0, 0, g.base);
    grad.addColorStop(0, pal.skyTop); grad.addColorStop(1, pal.skyBot);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, g.W, g.H);

    // grid
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1; ctx.fillStyle = pal.label; ctx.font = '10px system-ui, sans-serif';
    ctx.beginPath();
    for (let a = 15; a < g.altMax; a += 15) { const y = g.base - a * g.ppdY; ctx.moveTo(0, y); ctx.lineTo(g.W, y); }
    for (const [, az] of eighths) { const x = az * g.ppdX; ctx.moveTo(x, g.top); ctx.lineTo(x, g.base); }
    ctx.stroke();
    for (let a = 15; a < g.altMax; a += 15) ctx.fillText(a + '°', 3, g.base - a * g.ppdY - 3);

    if (scene.sky) paintObjects(ctx, g, scene, pal, hits);

    // ground
    const mask = scene.mask;
    ctx.beginPath(); ctx.moveTo(0, g.H);
    for (let az = 0; az <= 360; az += 1) { const p = g.xy(az, mask ? mask.alt[az % 360] : 0); ctx.lineTo(p[0], p[1]); }
    ctx.lineTo(g.W, g.H); ctx.closePath();
    ctx.fillStyle = pal.ground; ctx.fill();
    ctx.strokeStyle = scene.editing ? pal.accent : pal.edge; ctx.lineWidth = scene.editing ? 2 : 1.4; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let az = 0; az <= 360; az += 1) { const p = g.xy(az, mask ? mask.alt[az % 360] : 0); if (az) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
    ctx.stroke();

    // unmapped stretches
    if (scene.editing && mask) {
      let s = -1;
      for (let i = 0; i <= 360; i++) {
        const un = i < 360 && mask.state[i] === 0;
        if (un && s < 0) s = i;
        if (!un && s >= 0) {
          const x0 = s * g.ppdX, x1 = i * g.ppdX;
          ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x0, g.top, x1 - x0, g.base - g.top);
          if (x1 - x0 > 70) { ctx.fillStyle = pal.label; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('not mapped yet', (x0 + x1) / 2, g.top + 16); ctx.textAlign = 'start'; }
          s = -1;
        }
      }
    }
    // compass labels
    ctx.fillStyle = pal.label; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    for (const [t, az] of eighths) { const x = clamp(az * g.ppdX, 12, g.W - 12); ctx.fillText(t, x, g.H - 6); }
    ctx.textAlign = 'start';
    return { hits, geom: g };
  }

  function hit(hits, x, y) {
    let best = null, bd = 1e9;
    for (const h of hits) {
      const d = Math.hypot(h.x - x, h.y - y);
      const reach = Math.max(h.r, 11) + 6;
      if (d > reach) continue;
      const score = d - (h.pri || 0) * 3;
      if (score < bd) { bd = score; best = h; }
    }
    return best;
  }

  root.SL.chart = { drawDome, drawPano, panoGeom, hit, palette, bvColor, BODY_COL };
})(typeof self !== 'undefined' ? self : this);
