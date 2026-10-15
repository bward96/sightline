/* Sightline geometry: horizon mask, phone orientation maths, camera projection, skyline detection.
   Pure functions, no DOM. Angles in degrees unless noted. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.SL = root.SL || {}).geo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const wrap360 = a => ((a % 360) + 360) % 360;
  const wrap180 = a => ((((a + 180) % 360) + 360) % 360) - 180;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  /* ---------- horizon mask ---------- */
  const GAP_FILL = 25; // gaps up to this many degrees between traced points are interpolated

  function buildMask(strokes) {
    const raw = new Float32Array(360), cov = new Uint8Array(360);
    const put = (az, h) => { const i = Math.round(wrap360(az)) % 360; raw[i] = h; cov[i] = 1; };
    for (const s of strokes || []) {
      const p = s.pts;
      if (!p || !p.length) continue;
      if (p.length === 1) put(p[0][0], p[0][1]);
      for (let i = 0; i < p.length - 1; i++) {
        const a1 = p[i][0], h1 = p[i][1], a2 = p[i + 1][0], h2 = p[i + 1][1];
        const d = wrap180(a2 - a1);
        if (Math.abs(d) > 150) { put(a2, h2); continue; }
        const n = Math.max(1, Math.ceil(Math.abs(d)));
        for (let k = 0; k <= n; k++) put(a1 + (d * k) / n, h1 + ((h2 - h1) * k) / n);
      }
    }
    const alt = new Float32Array(360), state = new Uint8Array(360);
    let mapped = 0;
    for (let i = 0; i < 360; i++) if (cov[i]) { alt[i] = raw[i]; state[i] = 1; mapped++; }
    if (!mapped) return { alt, state, coverage: 0, max: 0, mapped: 0 };
    for (let i = 0; i < 360; i++) {
      if (!cov[i]) continue;
      let j = (i + 1) % 360, g = 1;
      while (!cov[j] && g < 360) { j = (j + 1) % 360; g++; }
      if (g > 1 && g - 1 <= GAP_FILL && j !== i) {
        for (let k = 1; k < g; k++) {
          const idx = (i + k) % 360;
          alt[idx] = raw[i] + ((raw[j] - raw[i]) * k) / g;
          state[idx] = 2;
        }
      }
    }
    let covered = 0, max = 0;
    for (let i = 0; i < 360; i++) { if (state[i]) covered++; if (alt[i] > max) max = alt[i]; }
    return { alt, state, coverage: covered / 360, max, mapped };
  }

  function maskAt(mask, az) {
    if (!mask) return 0;
    const a = wrap360(az), i = Math.floor(a) % 360, f = a - Math.floor(a);
    const m = mask.alt;
    return m[i] * (1 - f) + m[(i + 1) % 360] * f;
  }

  /* ---------- small linear algebra ---------- */
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const vnorm = a => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
  const rotZ = a => { const c = Math.cos(a * D2R), s = Math.sin(a * D2R); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
  const rotX = a => { const c = Math.cos(a * D2R), s = Math.sin(a * D2R); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
  const rotY = a => { const c = Math.cos(a * D2R), s = Math.sin(a * D2R); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
  const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const mulv = (A, v) => [dot(A[0], v), dot(A[1], v), dot(A[2], v)];
  const transpose = A => [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];

  /* ---------- phone orientation (W3C DeviceOrientation: Z-X'-Y'' Euler angles) ----------
     Earth frame: x = East, y = North, z = Up. Device frame: x = screen right, y = screen top,
     z = out of the screen. The back camera looks along device -z. */
  function eulerToMatrix(alpha, beta, gamma) { return mul(mul(rotZ(alpha), rotX(beta)), rotY(gamma)); }

  function orthonormalize(R) {
    let c1 = [R[0][0], R[1][0], R[2][0]], c2 = [R[0][1], R[1][1], R[2][1]];
    c1 = vnorm(c1);
    const d = dot(c1, c2);
    c2 = vnorm([c2[0] - c1[0] * d, c2[1] - c1[1] * d, c2[2] - c1[2] * d]);
    const c3 = cross(c1, c2);
    return [[c1[0], c2[0], c3[0]], [c1[1], c2[1], c3[1]], [c1[2], c2[2], c3[2]]];
  }
  function blendMatrix(A, B, t) {
    return orthonormalize(A.map((r, i) => r.map((x, j) => x + (B[i][j] - x) * t)));
  }
  function dirToAzAlt(e) {
    const n = vnorm(e);
    return { az: wrap360(Math.atan2(n[0], n[1]) * R2D), alt: Math.asin(clamp(n[2], -1, 1)) * R2D };
  }
  function azAltToDir(az, alt) {
    const a = az * D2R, h = alt * D2R;
    return [Math.sin(a) * Math.cos(h), Math.cos(a) * Math.cos(h), Math.sin(h)];
  }
  // where the back camera is pointing (sensor frame, before calibration)
  function pointing(R) { return dirToAzAlt([-R[0][2], -R[1][2], -R[2][2]]); }
  function angleBetween(az1, alt1, az2, alt2) {
    return Math.acos(clamp(dot(azAltToDir(az1, alt1), azAltToDir(az2, alt2)), -1, 1)) * R2D;
  }

  /* ---------- calibration ---------- */
  function applyCalib(p, calib) {
    const c = calib || { azOff: 0, altOff: 0 };
    return { az: wrap360(p.az + c.azOff), alt: clamp(p.alt + c.altOff, -90, 90) };
  }
  function calibFromTarget(sensor, truth) {
    return { azOff: wrap180(truth.az - sensor.az), altOff: truth.alt - sensor.alt };
  }

  /* ---------- camera model ----------
     view = { w, h, f, angle }: css-pixel size of the displayed camera image, focal length in css
     pixels, and screen.orientation.angle. f is derived from a normalised focal length so that it
     survives rotating the phone and different video resolutions. */
  function makeView(w, h, fnorm, vidW, vidH, angle) {
    const vw = vidW || w, vh = vidH || h;
    const s = Math.max(w / vw, h / vh);
    return { w, h, f: fnorm * Math.max(vw, vh) * s, angle: angle || 0 };
  }
  function fnormFromHfov(hfov, w, h, vidW, vidH) {
    const vw = vidW || w, vh = vidH || h;
    const s = Math.max(w / vw, h / vh);
    const fcss = (w / 2) / Math.tan((hfov * D2R) / 2);
    return fcss / (Math.max(vw, vh) * s);
  }
  function viewToDevice(u, v, angle) {
    switch (((angle % 360) + 360) % 360) {
      case 90: return [v, -u, -1];
      case 180: return [-u, -v, -1];
      case 270: return [-v, u, -1];
      default: return [u, v, -1];
    }
  }
  function deviceToView(x, y, angle) {
    switch (((angle % 360) + 360) % 360) {
      case 90: return [-y, x];
      case 180: return [-x, -y];
      case 270: return [y, -x];
      default: return [x, y];
    }
  }
  function pixelToAzAlt(R, x, y, view, calib) {
    const u = (x - view.w / 2) / view.f, v = -(y - view.h / 2) / view.f;
    return applyCalib(dirToAzAlt(mulv(R, viewToDevice(u, v, view.angle))), calib);
  }
  function azAltToPixel(R, az, alt, view, calib) {
    const c = calib || { azOff: 0, altOff: 0 };
    const d = mulv(transpose(R), azAltToDir(az - c.azOff, alt - c.altOff));
    if (d[2] > -0.02) return null; // behind or at the edge of the camera plane
    const tx = d[0] / -d[2], ty = d[1] / -d[2];
    const uv = deviceToView(tx, ty, view.angle);
    return { x: view.w / 2 + uv[0] * view.f, y: view.h / 2 - uv[1] * view.f };
  }

  /* ---------- skyline detection in a photo ---------- */
  // data: RGBA bytes. Returns Int16Array of skyline y per column (-1 = unknown).
  function detectSkyline(data, w, h, sens) {
    const thr = 22 + (1 - clamp(sens, 0, 1)) * 60;
    const L = new Float32Array(w * h), G = new Float32Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      G[i] = Math.min(g - r, g - b); // green dominance: foliage
    }
    const ys = new Int16Array(w).fill(-1);
    const top = Math.max(2, Math.floor(h * 0.03));
    for (let x = 0; x < w; x++) {
      let ref = 0, n = 0;
      for (let dx = -3; dx <= 3; dx++) {
        const xx = clamp(x + dx, 0, w - 1);
        for (let y = 0; y < top; y++) { ref += L[y * w + xx]; n++; }
      }
      ref /= n;
      let run = 0, start = -1;
      for (let y = top; y < h; y++) {
        const i = y * w + x;
        const nonSky = L[i] < ref - thr || G[i] > 14 + thr * 0.2;
        if (nonSky) { if (run === 0) start = y; run++; if (run >= 3) { ys[x] = start; break; } }
        else { run = 0; ref = ref * 0.9 + L[i] * 0.1; }
      }
    }
    // median filter across columns to drop single-column noise
    const out = new Int16Array(w).fill(-1);
    for (let x = 0; x < w; x++) {
      const win = [];
      for (let dx = -2; dx <= 2; dx++) { const v = ys[clamp(x + dx, 0, w - 1)]; if (v >= 0) win.push(v); }
      if (win.length >= 3) { win.sort((a, b) => a - b); out[x] = win[win.length >> 1]; }
    }
    return out;
  }

  return {
    D2R, R2D, wrap360, wrap180, clamp, buildMask, maskAt, eulerToMatrix, orthonormalize, blendMatrix,
    pointing, dirToAzAlt, azAltToDir, angleBetween, applyCalib, calibFromTarget, makeView,
    fnormFromHfov, pixelToAzAlt, azAltToPixel, detectSkyline, mulv, transpose, mul
  };
});
