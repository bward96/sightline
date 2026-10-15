/* Sightline astronomy engine: positions, light-pollution model, and "what can I see tonight". */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('astronomy-engine') : root.Astronomy, isNode ? require('./geo.js') : root.SL.geo);
  if (isNode) module.exports = api; else (root.SL = root.SL || {}).engine = api;
})(typeof self !== 'undefined' ? self : this, function (Astronomy, geo) {
  'use strict';
  const { D2R, R2D, clamp, maskAt, angleBetween } = geo;

  const BODY_LIST = ['Moon', 'Venus', 'Jupiter', 'Mars', 'Saturn', 'Mercury', 'Uranus', 'Neptune'];
  // Naked-eye limiting magnitude for Bortle classes 1..9 (class midpoints)
  const NELM = [7.8, 7.3, 6.8, 6.3, 5.8, 5.3, 4.8, 4.3, 3.9];
  const EQUIP = {
    naked: { gain: 0, label: 'Naked eye' },
    binos: { gain: 3.6, label: 'Binoculars' },
    scope: { gain: 5.4, label: 'Small telescope' }
  };
  const BORTLE_TEXT = [
    'Excellent dark sky', 'Typical dark sky', 'Rural sky', 'Rural / suburban transition', 'Suburban sky',
    'Bright suburban sky', 'Suburban / urban transition', 'City sky', 'Inner-city sky'
  ];
  const DSO_TYPES = {
    oc: 'Open cluster', gc: 'Globular cluster', pn: 'Planetary nebula', snr: 'Supernova remnant',
    s: 'Galaxy', e: 'Galaxy', i: 'Galaxy', bn: 'Nebula', en: 'Emission nebula', rn: 'Reflection nebula',
    sfr: 'Star-forming region', pos: 'Star cloud', '': 'Deep-sky object'
  };

  /* ---------- sky brightness and visibility model ---------- */
  function refraction(h) { // degrees of refraction for a true altitude h (degrees)
    if (h < -1) return 0;
    return 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D2R) / 60;
  }
  function airmass(h) {
    const hh = Math.max(h, 0.5);
    return 1 / Math.sin((hh + 244 / (165 + 47 * Math.pow(hh, 1.1))) * D2R);
  }
  const extinction = h => 0.28 * (Math.min(airmass(h), 38) - 1);
  // Extended objects look fainter than their integrated magnitude says.
  const BRIGHT_CORE = { M42: -0.9 }; // the Orion Nebula's core is far brighter than its average surface brightness suggests
  const DIFFUSE = { bn: 1, en: 1, rn: 1, sfr: 1, snr: 1 };
  function effectiveMag(mag, dims, type) {
    if (!dims || !dims[0]) return mag;
    let eff = mag + 0.5 * Math.log10(Math.max(1, dims[0] * (dims[1] || dims[0])));
    if (DIFFUSE[type] && dims[0] > 100) eff += 2.5; // big, faint glows are far harder than their total magnitude suggests
    return eff;
  }
  function skyLimit(base, gain, sunAlt) {
    if (sunAlt <= -18) return base;
    const t6 = Math.min(base, 2.5 + 0.4 * gain), t0 = -1.5;
    if (sunAlt <= -6) return base + (t6 - base) * ((sunAlt + 18) / 12);
    if (sunAlt <= -0.83) return t6 + (t0 - t6) * ((sunAlt + 6) / 5.17);
    return -4;
  }
  function moonPenalty(nelm, moon, az, alt) {
    if (!moon || moon.alt <= -2 || moon.frac < 0.02) return 0;
    const scale = clamp((nelm - 3.8) / 3.2, 0.25, 1);
    const altF = clamp((moon.alt + 2) / 25, 0, 1);
    const sepF = 1 - 0.5 * clamp(angleBetween(az, alt, moon.az, moon.alt) / 90, 0, 1);
    return 2.2 * scale * moon.frac * altF * sepF;
  }
  function phaseName(deg) {
    const names = ['New Moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full Moon',
      'Waning gibbous', 'Last quarter', 'Waning crescent'];
    return names[Math.floor(((deg + 22.5) % 360) / 45)];
  }

  /* ---------- helpers ---------- */
  const eqj = (raDeg, decDeg) => {
    const a = raDeg * D2R, d = decDeg * D2R;
    return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  };
  function flatVec(points) {
    const out = new Float64Array(points.length * 3);
    points.forEach((p, i) => { const v = eqj(p[0], p[1]); out[3 * i] = v[0]; out[3 * i + 1] = v[1]; out[3 * i + 2] = v[2]; });
    return out;
  }
  // Rotate EQJ vectors into the horizon frame and write apparent az/alt.
  function projectBuf(rot, v, n, outAz, outAlt) {
    const a = rot[0][0], b = rot[1][0], c = rot[2][0], d = rot[0][1], e = rot[1][1], f = rot[2][1],
      g = rot[0][2], h = rot[1][2], k = rot[2][2];
    for (let i = 0; i < n; i++) {
      const x = v[3 * i], y = v[3 * i + 1], z = v[3 * i + 2];
      const N = a * x + b * y + c * z, W = d * x + e * y + f * z, U = g * x + h * y + k * z;
      let alt = Math.asin(U < -1 ? -1 : U > 1 ? 1 : U) * R2D;
      alt += refraction(alt);
      let az = Math.atan2(-W, N) * R2D;
      if (az < 0) az += 360;
      outAz[i] = az; outAlt[i] = alt;
    }
  }
  function projectOne(rot, vec) {
    const az = new Float32Array(1), alt = new Float32Array(1);
    projectBuf(rot, vec, 1, az, alt);
    return [az[0], alt[0]];
  }
  const runs = (flags, steps, stepMs, endMs) => {
    const out = [];
    let s = -1;
    for (let i = 0; i <= flags.length; i++) {
      const on = i < flags.length && flags[i];
      if (on && s < 0) s = i;
      if (!on && s >= 0) { out.push([new Date(steps[s]), new Date(Math.min(steps[i - 1] + stepMs, endMs))]); s = -1; }
    }
    return out;
  };

  class Engine {
    constructor(data) {
      this.data = data;
      const n = data.stars.length;
      this.nStars = n;
      this.sv = new Float64Array(n * 3);
      this.smag = new Float32Array(n);
      this.sbv = new Float32Array(n);
      this.sname = new Array(n);
      this.sproper = new Uint8Array(n);
      data.stars.forEach((s, i) => {
        const v = eqj(s[0], s[1]);
        this.sv[3 * i] = v[0]; this.sv[3 * i + 1] = v[1]; this.sv[3 * i + 2] = v[2];
        this.smag[i] = s[2]; this.sbv[i] = s[3] == null ? 0.6 : s[3];
        this.sname[i] = s[4]; this.sproper[i] = s[5];
      });
      this.dso = data.dso.map(o => Object.assign({}, o, { vec: eqj(o.ra, o.dec), eff: effectiveMag(o.m, o.d, o.t) + (BRIGHT_CORE[o.id] || 0) }));
      this.dsoVec = new Float64Array(this.dso.length * 3);
      this.dso.forEach((o, i) => { this.dsoVec.set(o.vec, 3 * i); });
      this.lines = data.lines.map(l => ({ c: l.c, segs: l.l.map(flatVec) }));
      this.cons = data.cons.map(c => ({ c: c.c, n: c.n, vec: eqj(c.ra, c.dec) }));
      this.mw = data.mw.map(rings => rings.map(flatVec));
      this.obs = null;
    }

    setObserver(lat, lon) {
      this.lat = lat; this.lon = lon;
      this.obs = new Astronomy.Observer(lat, lon, 0);
    }

    frame(date) {
      const time = Astronomy.MakeTime(date);
      return { date: new Date(date), time, rot: Astronomy.Rotation_EQJ_HOR(time, this.obs).rot };
    }

    bodyHor(name, frame) {
      const eq = Astronomy.Equator(name, frame.time, this.obs, true, true);
      const hor = Astronomy.Horizon(frame.time, this.obs, eq.ra, eq.dec, 'normal');
      return { az: hor.azimuth, alt: hor.altitude };
    }

    moonInfo(date) {
      const time = Astronomy.MakeTime(date);
      const phase = Astronomy.MoonPhase(time);
      const ill = Astronomy.Illumination('Moon', time);
      return { phase, frac: ill.phase_fraction, name: phaseName(phase), waxing: phase < 180 };
    }

    /* Positions of everything for drawing the chart at one moment. */
    sky(frame, o) {
      o = o || {};
      const out = {};
      const sa = new Float32Array(this.nStars), sh = new Float32Array(this.nStars);
      projectBuf(frame.rot, this.sv, this.nStars, sa, sh);
      out.stars = { az: sa, alt: sh };
      const nd = this.dso.length, da = new Float32Array(nd), dh = new Float32Array(nd);
      projectBuf(frame.rot, this.dsoVec, nd, da, dh);
      out.dso = { az: da, alt: dh };
      const poly = vec => {
        const n = vec.length / 3, az = new Float32Array(n), alt = new Float32Array(n);
        projectBuf(frame.rot, vec, n, az, alt);
        return { az, alt };
      };
      if (o.lines) out.lines = this.lines.map(l => ({ c: l.c, segs: l.segs.map(poly) }));
      if (o.mw) out.mw = this.mw.map(rings => rings.map(poly));
      if (o.cons) out.cons = this.cons.map(c => { const p = projectOne(frame.rot, c.vec); return { c: c.c, n: c.n, az: p[0], alt: p[1] }; });
      if (o.bodies !== false) {
        out.bodies = ['Sun'].concat(BODY_LIST).map(name => {
          const p = this.bodyHor(name, frame);
          let mag = -26.7;
          if (name !== 'Sun') mag = Astronomy.Illumination(name, frame.time).mag;
          return { name, az: p.az, alt: p.alt, mag };
        });
      }
      return out;
    }

    /* Limiting magnitude to draw at one instant, plus Moon state. */
    chartLimit(frame, bortle, equip, bodies) {
      const gain = EQUIP[equip].gain, nelm = NELM[bortle - 1];
      const sun = bodies.find(b => b.name === 'Sun'), moonB = bodies.find(b => b.name === 'Moon');
      const mi = this.moonInfo(frame.date);
      const moon = { az: moonB.az, alt: moonB.alt, frac: mi.frac };
      let lim = skyLimit(nelm + gain, gain, sun.alt);
      lim -= moonPenalty(nelm, moon, moon.az + 60, Math.max(moon.alt, 0) * 0.5 + 20) * 0.9;
      return { limit: lim, sunAlt: sun.alt, moon, moonInfo: mi };
    }

    /* The dark window for a night: sunset -> next sunrise, with twilight details. */
    night(now, dayOffset) {
      const obs = this.obs;
      const dayMs = 86400000;
      const sunsetAfter = (from, days) => { const r = Astronomy.SearchRiseSet('Sun', obs, -1, from, days); return r ? r.date : null; };
      const sunriseAfter = (from, days) => { const r = Astronomy.SearchRiseSet('Sun', obs, +1, from, days); return r ? r.date : null; };
      let start = null;
      if (!dayOffset) {
        const f = this.frame(now);
        const sunAlt = this.bodyHor('Sun', f).alt;
        if (sunAlt < -0.83) start = sunsetAfter(new Date(+now - dayMs), 1.05);
        if (!start || +start > +now) start = sunsetAfter(now, 1.5);
      } else {
        const noon = new Date(now); noon.setHours(12, 0, 0, 0);
        start = sunsetAfter(new Date(+noon + dayOffset * dayMs), 1.2);
      }
      let end = start ? sunriseAfter(start, 1.5) : null;
      let polar = false;
      if (!start || !end) {
        polar = true;
        const noon = new Date(now); noon.setHours(12, 0, 0, 0);
        start = new Date(+noon + (dayOffset || 0) * dayMs + 6 * 3600000);
        end = new Date(+start + 12 * 3600000);
      }
      const alt = (dir, from, deg) => { const r = Astronomy.SearchAltitude('Sun', obs, dir, from, 1.2, deg); return r ? r.date : null; };
      const duskA = polar ? null : alt(-1, start, -18);
      const dawnA = polar || !duskA ? null : alt(+1, duskA, -18);
      const rs = (body, dir) => { const r = Astronomy.SearchRiseSet(body, obs, dir, start, 1.2); return r && +r.date <= +end + 3600000 ? r.date : null; };
      const mid = new Date((+start + +end) / 2);
      return {
        start, end, polar, sunset: polar ? null : start, sunrise: polar ? null : end, duskA, dawnA,
        moonRise: rs('Moon', +1), moonSet: rs('Moon', -1), moon: this.moonInfo(mid)
      };
    }

    /* Work out what is visible during [start, end] for one spot and equipment choice. */
    analyze(o) {
      const start = +o.start, end = +o.end, stepMs = (o.stepMin || 5) * 60000;
      const gain = EQUIP[o.equip].gain, nelm = NELM[o.bortle - 1], base = nelm + gain, mask = o.mask || null;
      const steps = [];
      for (let t = start; t <= end; t += stepMs) steps.push(t);
      const n = steps.length;
      const frames = steps.map(t => this.frame(new Date(t)));
      const sunAlt = new Float32Array(n), lim = new Float32Array(n);
      const moon = { az: new Float32Array(n), alt: new Float32Array(n), frac: 0 };
      const tracks = {};
      const names = ['Sun'].concat(BODY_LIST);
      names.forEach(nm => { tracks[nm] = { az: new Float32Array(n), alt: new Float32Array(n) }; });
      frames.forEach((f, i) => {
        names.forEach(nm => { const p = this.bodyHor(nm, f); tracks[nm].az[i] = p.az; tracks[nm].alt[i] = p.alt; });
        sunAlt[i] = tracks.Sun.alt[i];
        lim[i] = skyLimit(base, gain, sunAlt[i]);
        moon.az[i] = tracks.Moon.az[i]; moon.alt[i] = tracks.Moon.alt[i];
      });
      const midTime = frames[n >> 1].time;
      const mi = this.moonInfo(frames[n >> 1].date);
      moon.frac = mi.frac;

      const evalTrack = (azArr, altArr, eff, isMoon) => {
        const vis = new Uint8Array(n), clr = new Uint8Array(n);
        let bestV = -1, bestC = -1, bi = -1, bc = -1;
        for (let i = 0; i < n; i++) {
          const alt = altArr[i];
          if (alt < 0.3) continue;
          const az = azArr[i];
          const pen = isMoon ? 0 : moonPenalty(nelm, { az: moon.az[i], alt: moon.alt[i], frac: moon.frac }, az, alt);
          if (eff + extinction(alt) > lim[i] - pen) continue;
          clr[i] = 1;
          if (alt > bestC) { bestC = alt; bc = i; }
          if (alt >= maskAt(mask, az)) { vis[i] = 1; if (alt > bestV) { bestV = alt; bi = i; } }
        }
        const pi = bi >= 0 ? bi : bc;
        if (pi < 0) return null;
        return {
          vis: runs(vis, steps, stepMs, end), clear: runs(clr, steps, stepMs, end),
          peak: { alt: altArr[pi], az: azArr[pi], t: new Date(steps[pi]) },
          maskPeak: maskAt(mask, azArr[pi]), status: bi >= 0 ? 'visible' : 'blocked'
        };
      };

      const result = { bodies: [], stars: [], dso: [], meta: { base, nelm, gain, moon: mi, steps: n } };

      BODY_LIST.forEach(nm => {
        const tr = tracks[nm];
        const ill = Astronomy.Illumination(nm, midTime);
        const mag = ill.mag;
        const r = evalTrack(tr.az, tr.alt, mag, nm === 'Moon');
        if (!r) return;
        result.bodies.push(Object.assign({
          key: 'b:' + nm, kind: nm === 'Moon' ? 'moon' : 'planet', id: nm, name: nm, mag, eff: mag,
          sub: nm === 'Moon' ? `${Math.round(mi.frac * 100)}% lit · ${mi.name.toLowerCase()}` : 'Planet · mag ' + mag.toFixed(1),
          type: nm
        }, r));
      });

      const az = new Float32Array(n), alt = new Float32Array(n), tmp = new Float32Array(1), tmp2 = new Float32Array(1);
      const trackFixed = vec => {
        for (let i = 0; i < n; i++) {
          projectBuf(frames[i].rot, vec, 1, tmp, tmp2);
          az[i] = tmp[0]; alt[i] = tmp2[0];
        }
      };
      for (let i = 0; i < this.nStars; i++) {
        const mag = this.smag[i];
        if (!((this.sproper[i] && mag <= 3.6) || mag <= 2.2) || mag > base + 0.5) continue;
        trackFixed(this.sv.subarray(3 * i, 3 * i + 3));
        const r = evalTrack(az, alt, mag, false);
        if (!r) continue;
        result.stars.push(Object.assign({
          key: 's:' + i, kind: 'star', id: i, name: this.sname[i] || 'Star', mag, eff: mag, type: 'star',
          sub: 'Star · mag ' + mag.toFixed(1)
        }, r));
      }
      result.stars.sort((a, b) => a.mag - b.mag);

      this.dso.forEach((o, i) => {
        if (o.eff > base + 0.5) return;
        trackFixed(o.vec);
        const r = evalTrack(az, alt, o.eff, false);
        if (!r) return;
        const size = o.d[0] ? (o.d[0] >= 60 ? (o.d[0] / 60).toFixed(1) + '°' : Math.round(o.d[0]) + '′') : '';
        result.dso.push(Object.assign({
          key: 'd:' + i, kind: 'dso', id: i, ra: o.ra, dec: o.dec,
          name: o.n ? `${o.id} · ${o.n}` : o.ng ? `${o.id} (${o.ng})` : o.id, mag: o.m, eff: o.eff, type: o.t,
          sub: `${DSO_TYPES[o.t] || 'Deep-sky object'} · mag ${o.m.toFixed(1)}${size ? ' · ' + size : ''}`
        }, r));
      });
      result.dso.sort((a, b) => a.eff - b.eff);
      return result;
    }
  }

  return {
    Engine, BODY_LIST, NELM, EQUIP, BORTLE_TEXT, DSO_TYPES, refraction, airmass, extinction, effectiveMag,
    skyLimit, moonPenalty, phaseName, projectOne
  };
});
