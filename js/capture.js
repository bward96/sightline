/* Sightline capture: full-screen camera view with compass alignment, lens calibration,
   crosshair/tap tracing of the skyline, and freeze-frame photo tracing. */
(function (root) {
  'use strict';
  const geo = root.SL.geo, EN = root.SL.engine;
  const { clamp, wrap180 } = geo;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let st = null;

  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && 'DeviceOrientationEvent' in window);
  const screenAngle = () => (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
  const fmtDeg = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d == null ? 1 : d) + '°';
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };

  function open(opts) {
    if (st) return;
    st = {
      opts, mode: opts.mode || 'align', Rs: null, absolute: false, stream: null, videoOK: false, raf: 0, wake: null,
      cur: [], sweep: false, lastAdd: null, targets: [], targetKey: null, targetsAt: 0, lens: { left: null }, still: null,
      calib: Object.assign({ azOff: 0, altOff: 0, at: 0, target: '' }, opts.spot.calib || {}),
      W: 0, H: 0, drag: null, startedAt: performance.now(), relOnly: false,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f0b35a'
    };
    $('cap').hidden = false;
    try { history.pushState({ sl: 'cap' }, ''); st.pushed = true; } catch (e) { /* ignore */ }
    st.onPop = () => { if (st) close(true); };
    window.addEventListener('popstate', st.onPop);
    resize();
    window.addEventListener('resize', resize);
    startSensors();
    startCamera();
    bind();
    setMode(st.mode);
    if (navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').then(w => { st && (st.wake = w); }).catch(() => {});
    st.raf = requestAnimationFrame(frame);
  }

  function close(fromPop) {
    if (!st) return;
    cancelAnimationFrame(st.raf);
    window.removeEventListener('popstate', st.onPop);
    if (st.pushed && fromPop !== true && history.state && history.state.sl === 'cap') history.back();
    window.removeEventListener('resize', resize);
    window.removeEventListener('deviceorientationabsolute', st.hAbs, true);
    window.removeEventListener('deviceorientation', st.hRel, true);
    if (st.stream) st.stream.getTracks().forEach(t => t.stop());
    if (st.wake) st.wake.release().catch(() => {});
    const v = $('capVideo'); v.srcObject = null;
    $('capStill').hidden = true;
    $('cap').hidden = true;
    const cb = st.opts.onClose; st = null;
    if (cb) cb();
  }

  /* ---------- sensors and camera ---------- */
  function startSensors() {
    const feed = e => {
      const M = geo.eulerToMatrix(e.alpha, e.beta, e.gamma);
      st.Rs = st.Rs ? geo.blendMatrix(st.Rs, M, 0.35) : M;
    };
    st.hAbs = e => { if (e.alpha == null || e.beta == null) return; st.absolute = true; feed(e); };
    st.hRel = e => { if (st.absolute || e.alpha == null || e.beta == null) return; st.relOnly = true; feed(e); };
    window.addEventListener('deviceorientationabsolute', st.hAbs, true);
    window.addEventListener('deviceorientation', st.hRel, true);
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().catch(() => {});
    }
    setTimeout(() => {
      if (!st) return;
      if (!st.Rs) banner('No motion-sensor data. In Chrome, open Site settings and allow Motion sensors for this site.');
      else if (!st.absolute && st.relOnly) banner('This browser only gives a relative compass. Use Align on the Sun, Moon or a bright star each time you open this screen.');
    }, 1800);
  }

  async function startCamera() {
    const v = $('capVideo');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      if (!st) { stream.getTracks().forEach(t => t.stop()); return; }
      st.stream = stream;
      v.srcObject = stream;
      await v.play().catch(() => {});
      st.videoOK = true;
    } catch (e) {
      banner(e && e.name === 'NotAllowedError' ? 'Camera blocked. Allow camera access for this site in Chrome settings, then reopen this screen.' : 'Camera unavailable: ' + (e && e.message ? e.message : 'unknown error'));
    }
  }

  function banner(text) { const b = $('capBanner'); if (!text) { b.hidden = true; return; } b.textContent = text; b.hidden = false; }
  function resize() {
    if (!st) return;
    const cap = $('cap'), c = $('capOverlay'), dpr = Math.min(window.devicePixelRatio || 1, 3);
    st.W = cap.clientWidth; st.H = cap.clientHeight;
    c.width = Math.round(st.W * dpr); c.height = Math.round(st.H * dpr);
    st.ctx = c.getContext('2d'); st.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function currentView() {
    const v = $('capVideo');
    return geo.makeView(st.W, st.H, st.opts.settings.fnorm, v.videoWidth, v.videoHeight, screenAngle());
  }

  /* ---------- targets for compass alignment ---------- */
  function computeTargets() {
    const eng = st.opts.eng, now = new Date(), f = eng.frame(now);
    const list = [];
    const sun = eng.bodyHor('Sun', f);
    list.push({ key: 'Sun', name: 'Sun', az: sun.az, alt: sun.alt, ok: sun.alt > 3, pri: 0, note: 'Look at the screen, never at the Sun.' });
    const moon = eng.bodyHor('Moon', f);
    list.push({ key: 'Moon', name: 'Moon', az: moon.az, alt: moon.alt, ok: moon.alt > 5, pri: 1 });
    const dark = sun.alt < -6;
    ['Venus', 'Jupiter', 'Mars', 'Saturn', 'Mercury'].forEach(n => {
      const p = eng.bodyHor(n, f), mag = root.Astronomy.Illumination(n, f.time).mag;
      list.push({ key: n, name: n, az: p.az, alt: p.alt, ok: p.alt > 8 && mag < 2.2 && (dark || sun.alt < -1.5), pri: 2 + mag / 10 });
    });
    for (let i = 0; i < eng.nStars; i++) {
      const nm = eng.sname[i];
      if (!(eng.smag[i] < 1.7 || nm === 'Polaris')) continue;
      const p = EN.projectOne(f.rot, eng.sv.subarray(3 * i, 3 * i + 3));
      list.push({ key: 's' + i, name: nm || 'Star', az: p[0], alt: p[1], ok: dark && p[1] > 10, pri: nm === 'Polaris' ? 9 : 5 + eng.smag[i] / 10 });
    }
    st.targets = list.filter(t => t.ok).sort((a, b) => a.pri - b.pri);
    st.targetsAt = Date.now();
    if (!st.targets.some(t => t.key === st.targetKey)) st.targetKey = st.targets[0] ? st.targets[0].key : null;
  }
  const target = () => st.targets.find(t => t.key === st.targetKey) || null;

  /* ---------- modes and panels ---------- */
  function setMode(m) {
    if (m !== 'photo' && st.still) clearStill();
    st.mode = m; st.sweep = false;
    document.querySelectorAll('#capTabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.m === m)));
    renderPanel();
  }

  function renderPanel() {
    const p = $('capPanel');
    if (st.mode === 'align') {
      computeTargets();
      const c = st.calib;
      p.innerHTML = `
        <p>Point the cross-hair at something whose position the app knows. This removes compass error, which is often 10–20°.</p>
        <div class="chips" id="alignChips">${st.targets.length ? st.targets.map(t => `<button class="chip" data-k="${esc(t.key)}" aria-pressed="${t.key === st.targetKey}">${esc(t.name)}</button>`).join('') : '<span class="muted">Nothing bright enough is up right now. Try again at dusk, or when the Sun or Moon is visible.</span>'}</div>
        <div class="guide" id="alignGuide">&nbsp;</div>
        <div class="btn-row"><button class="btn primary" id="alignGo" ${st.targets.length ? '' : 'disabled'}>Align here</button><button class="btn" id="alignReset">Reset</button></div>
        <p id="alignInfo">${c.at ? `Offset ${fmtDeg(c.azOff)} from ${esc(c.target || 'target')}, ${ago(c.at)}.` : 'Not aligned yet.'}${target() && target().note ? ' ' + esc(target().note) : ''}</p>`;
    } else if (st.mode === 'lens') {
      p.innerHTML = `
        <p>Measures your camera's field of view so tracing from the screen is accurate. Pick a distinct landmark, like a chimney or lamp post. Put it on the <b>left</b> guide line, tap Mark, then turn the phone to put it on the <b>right</b> guide line and tap Mark again. Keep the phone in the position you will trace in.</p>
        <div class="btn-row"><button class="btn primary" id="lensMark">${st.lens.left ? 'Mark right' : 'Mark left'}</button><button class="btn" id="lensReset">Start over</button></div>
        <p id="lensInfo">Field of view now: <b>${fovNow()}°</b> across the screen.</p>`;
    } else if (st.mode === 'trace') {
      p.innerHTML = `
        <p id="traceHint">Aim the cross-hair at the <b>top edge</b> of trees, fences and roofs, then tap Add. You can also tap the screen right on the edge. Work around the horizon in one direction.</p>
        <div class="shutter-row"><button class="btn" id="tUndo">Undo</button><button class="shutter" id="tAdd" aria-label="Add point">Add</button><button class="btn" id="tSweep" aria-pressed="false">Sweep</button></div>
        <div class="btn-row"><button class="btn primary" id="tDone" disabled>Save line</button></div>`;
      updateTrace();
    } else {
      renderPhotoPanel();
    }
  }
  const fovNow = () => {
    const v = $('capVideo'), view = geo.makeView(st.W, st.H, st.opts.settings.fnorm, v.videoWidth, v.videoHeight, 0);
    return (2 * Math.atan(st.W / 2 / view.f) * 180 / Math.PI).toFixed(0);
  };

  function renderPhotoPanel() {
    const p = $('capPanel');
    if (!st.still) {
      p.innerHTML = `
        <p>Take a photo of the skyline, then trace it with your finger or let the app find it. Photos work best in daylight with clear or evenly clouded sky.</p>
        <div class="shutter-row"><span></span><button class="shutter" id="pShot" aria-label="Take photo">Shoot</button><span style="width:84px"></span></div>`;
    } else {
      p.innerHTML = `
        <p>Draw along the top edge of everything that blocks the sky, left to right or right to left. Several strokes are fine.</p>
        <div class="field"><label for="pSens" style="color:#fffc">Auto-detect sensitivity</label><input type="range" id="pSens" min="0" max="100" value="${st.still.sens}"></div>
        <div class="btn-row"><button class="btn" id="pAuto">Auto-detect</button><button class="btn" id="pClear">Clear</button><button class="btn" id="pRetake">Retake</button></div>
        <div class="btn-row"><button class="btn primary" id="pSave" ${st.still.strokes.length ? '' : 'disabled'}>Save skyline</button></div>`;
    }
  }
  function updateTrace() {
    const done = $('tDone'); if (!done) return;
    done.textContent = st.cur.length ? `Save line (${st.cur.length} point${st.cur.length === 1 ? '' : 's'})` : 'Save line';
    done.disabled = st.cur.length < 2;
    const s = $('tSweep'); if (s) s.setAttribute('aria-pressed', String(st.sweep));
  }

  /* ---------- actions ---------- */
  const crosshair = () => st.Rs ? geo.applyCalib(geo.pointing(st.Rs), st.calib) : null;

  function addPoint(p) {
    st.cur.push([Math.round(p.az * 10) / 10, Math.round(clamp(p.alt, 0, 89.5) * 10) / 10]);
    st.lastAdd = p; updateTrace();
  }
  function decimate(pts) {
    const out = [];
    pts.forEach((p, i) => {
      const l = out[out.length - 1];
      if (!l || Math.abs(wrap180(p[0] - l[0])) >= 0.8 || Math.abs(p[1] - l[1]) >= 0.8 || i === pts.length - 1) out.push(p);
    });
    return out;
  }

  function takePhoto() {
    const v = $('capVideo');
    if (!st.Rs) { toast('Waiting for the compass. Move the phone a little and try again.'); return; }
    if (!st.videoOK || !v.videoWidth) { toast('Camera is not ready.'); return; }
    const c = $('capStill'), w = v.videoWidth, h = v.videoHeight;
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    c.hidden = false;
    st.still = { R: st.Rs.map(r => r.slice()), view: currentView(), vw: w, vh: h, strokes: [], sens: 55 };
    renderPhotoPanel();
  }
  function clearStill() { st.still = null; $('capStill').hidden = true; if (st.mode === 'photo') renderPhotoPanel(); }
  const toast = m => st.opts.toast && st.opts.toast(m);

  function imgToCss(xi, yi) {
    const s = Math.max(st.W / st.still.vw, st.H / st.still.vh);
    return [xi * s - (st.still.vw * s - st.W) / 2, yi * s - (st.still.vh * s - st.H) / 2];
  }
  function autoDetect() {
    const still = st.still, tw = 320, th = Math.max(2, Math.round(tw * still.vh / still.vw));
    const tmp = document.createElement('canvas'); tmp.width = tw; tmp.height = th;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.drawImage($('capStill'), 0, 0, tw, th);
    const ys = geo.detectSkyline(tctx.getImageData(0, 0, tw, th).data, tw, th, still.sens / 100);
    const strokes = []; let cur = [], prevY = null;
    for (let x = 0; x < tw; x += 2) {
      const y = ys[x];
      if (y < 0 || (prevY != null && Math.abs(y - prevY) > th * 0.35)) { if (cur.length > 2) strokes.push(cur); cur = []; if (y < 0) { prevY = null; continue; } }
      const p = imgToCss((x / tw) * still.vw, (y / th) * still.vh);
      if (p[0] >= 0 && p[0] <= st.W && p[1] >= 0 && p[1] <= st.H) cur.push({ x: p[0], y: p[1] });
      prevY = y;
    }
    if (cur.length > 2) strokes.push(cur);
    still.strokes = strokes;
    if (!strokes.length) toast('Could not find a skyline. Try a different sensitivity or draw it by hand.');
    renderPhotoPanel();
  }
  function saveStill() {
    const still = st.still; let n = 0;
    still.strokes.forEach(s => {
      const pts = decimate(s.map(p => { const a = geo.pixelToAzAlt(still.R, p.x, p.y, still.view, st.calib); return [Math.round(a.az * 10) / 10, Math.round(clamp(a.alt, 0, 89.5) * 10) / 10]; }));
      if (pts.length > 1) { st.opts.onStroke({ kind: 'photo', t: Date.now(), pts }); n++; }
    });
    toast(n ? `Saved ${n} line${n > 1 ? 's' : ''} to your horizon.` : 'Nothing to save yet.');
    clearStill();
  }

  /* ---------- events ---------- */
  function bind() {
    const cap = $('cap');
    cap.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      const id = b.id;
      if (id === 'capClose') return close(false);
      if (b.parentElement && b.parentElement.id === 'capTabs') return setMode(b.dataset.m);
      if (b.parentElement && b.parentElement.id === 'alignChips') { st.targetKey = b.dataset.k; renderPanel(); return; }
      if (id === 'alignGo') {
        const t = target(); if (!t || !st.Rs) return toast('Waiting for the compass.');
        const c = geo.calibFromTarget(geo.pointing(st.Rs), t);
        st.calib = { azOff: c.azOff, altOff: c.altOff, at: Date.now(), target: t.name };
        st.opts.onCalib(st.calib); toast(`Aligned on ${t.name}: compass was ${fmtDeg(-c.azOff)} off.`); renderPanel();
      } else if (id === 'alignReset') {
        st.calib = { azOff: 0, altOff: 0, at: 0, target: '' }; st.opts.onCalib(st.calib); renderPanel();
      } else if (id === 'lensMark') {
        if (!st.Rs) return toast('Waiting for the compass.');
        const p = geo.pointing(st.Rs);
        if (!st.lens.left) { st.lens.left = p; renderPanel(); toast('Now turn so the landmark is on the right guide.'); return; }
        const A = geo.angleBetween(st.lens.left.az, st.lens.left.alt, p.az, p.alt);
        const half = (0.5 - 0.12) * st.W, fcss = half / Math.tan((A / 2) * Math.PI / 180);
        const hfov = 2 * Math.atan(st.W / 2 / fcss) * 180 / Math.PI;
        if (!(A > 8 && hfov > 25 && hfov < 120)) { st.lens.left = null; renderPanel(); return toast('That did not look right. Try again, turning slowly in a flat sweep.'); }
        const v = $('capVideo');
        st.opts.onFnorm(geo.fnormFromHfov(hfov, st.W, st.H, v.videoWidth, v.videoHeight));
        st.lens.left = null; renderPanel(); toast(`Field of view set to ${hfov.toFixed(0)}°.`);
      } else if (id === 'lensReset') {
        st.lens.left = null; st.opts.onFnorm(0.74); renderPanel();
      } else if (id === 'tAdd') {
        const p = crosshair(); if (!p) return toast('Waiting for the compass.'); addPoint(p);
      } else if (id === 'tUndo') {
        st.cur.pop(); updateTrace();
      } else if (id === 'tSweep') {
        st.sweep = !st.sweep; updateTrace();
      } else if (id === 'tDone') {
        const pts = decimate(st.cur);
        st.opts.onStroke({ kind: 'sensor', t: Date.now(), pts }); toast('Line saved to your horizon.');
        st.cur = []; st.sweep = false; st.lastAdd = null; updateTrace();
      } else if (id === 'pShot') takePhoto();
      else if (id === 'pAuto') autoDetect();
      else if (id === 'pClear') { st.still.strokes = []; renderPhotoPanel(); }
      else if (id === 'pRetake') clearStill();
      else if (id === 'pSave') saveStill();
    };
    $('capPanel').oninput = e => { if (e.target.id === 'pSens' && st.still) { st.still.sens = +e.target.value; clearTimeout(st.sensT); st.sensT = setTimeout(() => { if (st && st.still) autoDetect(); }, 120); } };

    const ov = $('capOverlay');
    ov.onpointerdown = e => {
      st.drag = { x: e.clientX, y: e.clientY, moved: 0, pts: st.mode === 'photo' && st.still ? [{ x: e.clientX, y: e.clientY }] : null };
      try { ov.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    };
    ov.onpointermove = e => {
      const d = st.drag; if (!d) return;
      d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x, e.clientY - d.y));
      if (d.pts) { const l = d.pts[d.pts.length - 1]; if (Math.hypot(e.clientX - l.x, e.clientY - l.y) > 3) d.pts.push({ x: e.clientX, y: e.clientY }); }
    };
    ov.onpointerup = e => {
      const d = st.drag; st.drag = null; if (!d) return;
      if (d.pts && d.pts.length > 2) { st.still.strokes.push(d.pts); renderPhotoPanel(); }
      else if (st.mode === 'trace' && d.moved < 10 && st.Rs) {
        addPoint(geo.pixelToAzAlt(st.Rs, e.clientX, e.clientY, currentView(), st.calib));
      }
    };
    document.onkeydown = e => { if (st && e.key === 'Escape') close(false); };
  }

  /* ---------- drawing ---------- */
  function frame() {
    if (!st) return;
    st.raf = requestAnimationFrame(frame);
    const ctx = st.ctx, W = st.W, H = st.H;
    ctx.clearRect(0, 0, W, H);
    const R = st.still ? st.still.R : st.Rs;
    const cross = crosshair();
    $('capReadout').textContent = cross ? `Az ${cross.az.toFixed(1)}°  Alt ${cross.alt.toFixed(1)}°` : 'Waiting for compass…';
    if (st.mode === 'align' && Date.now() - st.targetsAt > 8000) computeTargets();
    if (R) {
      const view = st.still ? st.still.view : currentView();
      drawHorizon(ctx, R, view);
      if (st.mode === 'align') drawAlign(ctx, R, view, cross);
      if (st.mode === 'trace') drawTrace(ctx, R, view, cross);
      if (st.mode === 'lens') drawLens(ctx);
      if (st.mode === 'photo' && st.still) drawStillStrokes(ctx);
    }
    if (!st.still) drawCrosshair(ctx, W / 2, H / 2);
  }

  function drawHorizon(ctx, R, view) {
    const calib = st.calib, mask = st.opts.getMask ? st.opts.getMask() : null;
    const line = (fn, style, width, dash) => {
      ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.beginPath();
      let pen = false, last = null;
      for (let az = 0; az <= 360; az += 2) {
        const alt = fn(az), p = geo.azAltToPixel(R, az, alt, view, calib);
        const ok = p && p.x > -200 && p.x < view.w + 200 && p.y > -400 && p.y < view.h + 400;
        if (ok && !(last && Math.hypot(p.x - last.x, p.y - last.y) > view.w)) { if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); pen = true; last = p; }
        else { pen = false; last = null; }
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    line(() => 0, 'rgba(255,255,255,.45)', 1, [6, 6]);
    if (mask && mask.mapped) line(az => geo.maskAt(mask, az), st.accent, 2.5);
    ctx.fillStyle = '#fff'; ctx.font = '700 13px system-ui'; ctx.textAlign = 'center';
    [['N', 0], ['E', 90], ['S', 180], ['W', 270], ['NE', 45], ['SE', 135], ['SW', 225], ['NW', 315]].forEach(([t, az]) => {
      const p = geo.azAltToPixel(R, az, 0, view, calib);
      if (p && p.x > 10 && p.x < view.w - 10 && p.y > 10 && p.y < view.h - 10) { ctx.fillText(t, p.x, p.y - 8); ctx.fillRect(p.x - 0.5, p.y - 4, 1, 8); }
    });
    ctx.textAlign = 'start';
  }

  function drawCrosshair(ctx, x, y) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 30, y); ctx.lineTo(x - 8, y); ctx.moveTo(x + 8, y); ctx.lineTo(x + 30, y);
    ctx.moveTo(x, y - 30); ctx.lineTo(x, y - 8); ctx.moveTo(x, y + 8); ctx.lineTo(x, y + 30); ctx.stroke();
  }

  function drawAlign(ctx, R, view, cross) {
    const t = target(), g = $('alignGuide');
    if (!t || !cross) { if (g) g.innerHTML = '&nbsp;'; return; }
    // refresh the moving target position
    const fresh = st.opts.eng.frame(new Date());
    let pos;
    if (/^s\d+$/.test(t.key)) { const i = +t.key.slice(1); pos = EN.projectOne(fresh.rot, st.opts.eng.sv.subarray(3 * i, 3 * i + 3)); pos = { az: pos[0], alt: pos[1] }; }
    else pos = st.opts.eng.bodyHor(t.key, fresh);
    t.az = pos.az; t.alt = pos.alt;
    const dAz = wrap180(t.az - cross.az), dAlt = t.alt - cross.alt;
    const on = Math.abs(dAz) < 1.2 && Math.abs(dAlt) < 1.2;
    if (g) {
      g.className = 'guide' + (on ? ' lock' : '');
      g.textContent = on ? `On ${t.name}. Tap Align here.` : `${t.name}: ${Math.abs(dAz) < 0.5 ? '' : (dAz > 0 ? 'turn right ' : 'turn left ') + Math.abs(dAz).toFixed(0) + '°'}${Math.abs(dAz) >= 0.5 && Math.abs(dAlt) >= 0.5 ? ', ' : ''}${Math.abs(dAlt) < 0.5 ? '' : (dAlt > 0 ? 'tilt up ' : 'tilt down ') + Math.abs(dAlt).toFixed(0) + '°'}`;
    }
    const p = geo.azAltToPixel(R, t.az, t.alt, view, st.calib);
    if (p && p.x > 0 && p.x < view.w && p.y > 0 && p.y < view.h) {
      ctx.strokeStyle = on ? '#6ed3a2' : '#ffd66b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 22, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.font = '600 13px system-ui'; ctx.fillText(t.name, p.x + 28, p.y + 4);
    }
  }

  function drawTrace(ctx, R, view, cross) {
    const accent = '#ffd66b';
    if (st.sweep && cross) {
      const l = st.lastAdd;
      if (!l || Math.abs(wrap180(cross.az - l.az)) >= 2.5 || Math.abs(cross.alt - l.alt) >= 3) addPoint(cross);
    }
    ctx.strokeStyle = accent; ctx.fillStyle = accent; ctx.lineWidth = 2.5; ctx.beginPath();
    let pen = false;
    st.cur.forEach(pt => {
      const p = geo.azAltToPixel(R, pt[0], pt[1], view, st.calib);
      if (!p) { pen = false; return; }
      if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); pen = true;
    });
    ctx.stroke();
    st.cur.forEach(pt => { const p = geo.azAltToPixel(R, pt[0], pt[1], view, st.calib); if (p) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill(); } });
  }

  function drawLens(ctx) {
    const W = st.W, H = st.H, x0 = W * 0.12, x1 = W * 0.88;
    ctx.strokeStyle = '#ffd66b'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(x0, 90); ctx.lineTo(x0, H - 190); ctx.moveTo(x1, 90); ctx.lineTo(x1, H - 190); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffd66b'; ctx.font = '700 13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(st.lens.left ? 'RIGHT' : 'LEFT', st.lens.left ? x1 : x0, 82); ctx.textAlign = 'start';
  }

  function drawStillStrokes(ctx) {
    const all = st.still.strokes.slice();
    if (st.drag && st.drag.pts) all.push(st.drag.pts);
    ctx.strokeStyle = '#ffd66b'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    all.forEach(s => { ctx.beginPath(); s.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); });
  }

  root.SL.capture = { open, close, supported };
})(typeof self !== 'undefined' ? self : this);
