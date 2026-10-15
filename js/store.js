/* Sightline storage: spots (places you observe from), their horizon traces, and settings. localStorage only. */
(function (root) {
  'use strict';
  const KEY = 'sightline.v1';
  const defaults = () => ({
    v: 1,
    settings: { theme: 'auto', equip: 'naked', fnorm: 0.74, hour24: true, layers: { lines: true, labels: true, dso: true, mw: true } },
    spots: [], current: null
  });
  let state = defaults(), timer = null;

  function sanitizeSpot(s) {
    if (!s || typeof s !== 'object') return null;
    const lat = Number(s.lat), lon = Number(s.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const strokes = (Array.isArray(s.strokes) ? s.strokes : []).map(k => ({
      kind: String(k.kind || 'draw'), t: Number(k.t) || 0,
      pts: (Array.isArray(k.pts) ? k.pts : []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10])
    })).filter(k => k.pts.length);
    const c = s.calib || {};
    return {
      id: String(s.id || uid()), name: String(s.name || 'My spot').slice(0, 40), lat, lon,
      bortle: Math.min(9, Math.max(1, Math.round(Number(s.bortle) || 6))), strokes,
      calib: { azOff: Number(c.azOff) || 0, altOff: Number(c.altOff) || 0, at: Number(c.at) || 0, target: String(c.target || '') },
      created: Number(s.created) || Date.now()
    };
  }
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

  function load() {
    state = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw), d = defaults();
        state.settings = Object.assign(d.settings, p.settings || {});
        state.settings.layers = Object.assign(d.settings.layers, (p.settings || {}).layers || {});
        state.spots = (Array.isArray(p.spots) ? p.spots : []).map(sanitizeSpot).filter(Boolean);
        state.current = p.current;
      }
    } catch (e) { state = defaults(); }
    if (!state.spots.some(s => s.id === state.current)) state.current = state.spots[0] ? state.spots[0].id : null;
    return state;
  }
  function flush() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ } }
  function save() { clearTimeout(timer); timer = setTimeout(flush, 200); }

  function addSpot(o) {
    const s = sanitizeSpot({ name: o.name, lat: o.lat, lon: o.lon, bortle: o.bortle || 6, strokes: [], calib: o.calib });
    state.spots.push(s); state.current = s.id; save(); return s;
  }
  function removeSpot(id) {
    state.spots = state.spots.filter(s => s.id !== id);
    if (state.current === id) state.current = state.spots[0] ? state.spots[0].id : null;
    save();
  }
  const current = () => state.spots.find(s => s.id === state.current) || null;
  const setCurrent = id => { if (state.spots.some(s => s.id === id)) { state.current = id; save(); } };

  function exportText() { return JSON.stringify({ app: 'sightline', exported: new Date().toISOString(), settings: state.settings, spots: state.spots }, null, 1); }
  function importText(text) {
    const p = JSON.parse(text);
    if (!p || p.app !== 'sightline' || !Array.isArray(p.spots)) throw new Error('This is not a Sightline backup.');
    let n = 0;
    p.spots.map(sanitizeSpot).filter(Boolean).forEach(s => {
      if (state.spots.some(x => x.id === s.id)) s.id = uid();
      state.spots.push(s); n++;
    });
    if (!state.current && state.spots[0]) state.current = state.spots[0].id;
    save();
    return n;
  }
  function reset() { state = defaults(); try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  (root.SL = root.SL || {}).store = {
    load, save, flush, addSpot, removeSpot, current, setCurrent, exportText, importText, reset,
    get state() { return state; }, get settings() { return state.settings; }, sanitizeSpot
  };
})(typeof self !== 'undefined' ? self : this);
