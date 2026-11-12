// The 3D sun view that runs inside the app's web view (TEST app, stop page, Sun & Moon -> 3D).
// The app drives it through window.S3D; it answers with window.ReactNativeWebView.postMessage(JSON).
//   S3D.init(cfg)   cfg = { n, north, south, west, east, W, D, base, step, ground, eye:{lat,lng}, target:{lat,lng}, focal,
//                           near?: { n, north, south, west, east, base, step } }   a small fine grid around the shot, inside the wide one
//   S3D.chunk(b64)  the elevation file, in base64 pieces; S3D.chunk(b64, 'near') for the fine grid's file; then S3D.done()
//   S3D.sun(az, alt)  degrees, from the app's own sun engine      S3D.focal(mm)
//   S3D.view(eyeLat, eyeLng, targetLat, targetLng)                S3D.path([[minute, az, alt], ...]) -> 'moments'
// Two levels (Faroes close-ups): the wide grid (far) draws everything; where a near grid is given, the far mesh is cut
// out inside it and a second, finer mesh is drawn there (denser around the shot), lit from its own heights, with
// shadows that carry on into the far grid beyond its edge. The point checks use the finer grid where it holds the pin.
// The subject may sit outside the near box (Tetons: a sharp foreground around the stand spot, the peak 10-25 km off on
// the far grid): the view is aimed as on the far grid alone and the subject's sun is read from the far grid.
// Built into src/components/sun/sun3dHtml.ts by tools/sun3d/build_app_html.js. Do not edit the generated file.
(function () {
  const post = m => { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) { /* not in the app */ } };
  const say = t => { const m = document.getElementById('msg'); m.textContent = t || ''; m.style.display = t ? 'flex' : 'none'; };
  const fail = t => { say(t); post({ type: 'error', msg: t }); };
  window.onerror = msg => { post({ type: 'error', msg: String(msg) }); };

  let cfg = null, parts = [], nparts = [], FAR = null, NR = null, maxH = 4250, baseH = 0;
  let R = null;   // everything three.js, once built
  let eye = null, eye0 = null, target = null, yaw = 0, pitch = 0, focal = 50, lens = { f: 135, fw: 120, fh: 96, box: true }, inline = false, sun = { az: 180, alt: 20 }, dirty = true, relight = true, hiTimer = null;
  const G = 768;  // mesh points per side

  // A grid: n x n heights (HF, row 0 = north) over a lat/lng box; x0, z0, w, d place it in the far grid's metres.
  const gh = (g, c, r) => {
    const n = g.n, H = g.HF;
    c = Math.max(0, Math.min(n - 1.001, c)); r = Math.max(0, Math.min(n - 1.001, r));
    const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, i = r0 * n + c0;
    return (H[i] * (1 - fc) + H[i + 1] * fc) * (1 - fr) + (H[i + n] * (1 - fc) + H[i + n + 1] * fc) * fr;
  };
  const crg = (g, p) => ({ c: (p.lng - g.west) / (g.east - g.west) * g.n - 0.5, r: (g.north - p.lat) / (g.north - g.south) * g.n - 0.5 });
  const cr = p => crg(FAR, p);
  // the grid a pin is read from: the near one when the pin is inside it, past the strip where the two meshes meet
  const pick = p => {
    if (NR) { const q = crg(NR, p); if (Math.min((q.c + 0.5) * NR.dx, (NR.n - 0.5 - q.c) * NR.dx, (q.r + 0.5) * NR.dz, (NR.n - 0.5 - q.r) * NR.dz) >= NR.band) return { g: NR, c: q.c, r: q.r }; }
    const q = cr(p); return { g: FAR, c: q.c, r: q.r };
  };
  function vis(p, ux, uz, tanA) {
    let g = p.g, c = p.c, r = p.r, L = g === NR ? 5 : 30, d = 0, v = 1;
    for (let k = 0; k < 260; k++) {
      d += L; let cc = c + ux * d / g.dx, rr = r + uz * d / g.dz; const hh = p.h + 3 + tanA * d;
      if (g === NR && (cc < 0 || rr < 0 || cc > g.n - 1 || rr > g.n - 1)) {   // past the near grid's edge: carry on in the far one
        c = (NR.x0 + (c + 0.5) * NR.dx) / FAR.dx - 0.5; r = (NR.z0 + (r + 0.5) * NR.dz) / FAR.dz - 0.5; g = FAR;
        cc = c + ux * d / g.dx; rr = r + uz * d / g.dz;
      }
      if (cc < 0 || rr < 0 || cc > g.n - 1 || rr > g.n - 1 || hh > maxH) break;
      const cl = hh - gh(g, cc, rr);
      if (cl <= 0) return 0;
      const s = cl / (d * 0.02); if (s < v) v = s;
      L *= 1.03;
    }
    return v;
  }
  // the highest grid point close to a pin: a summit pin a few metres off would sit in the summit's own shadow
  const snap = (q, rad) => { const g = q.g, n = g.n; let best = null; for (let r = Math.round(q.r) - rad; r <= Math.round(q.r) + rad; r++) for (let c = Math.round(q.c) - rad; c <= Math.round(q.c) + rad; c++) { if (r < 0 || c < 0 || r >= n || c >= n) continue; const h = g.HF[r * n + c]; if (!best || h > best.h) best = { g, c, r, h }; } return best; };
  const sunVec = (az, alt) => { const a = alt * Math.PI / 180, z = az * Math.PI / 180; return { x: Math.sin(z) * Math.cos(a), y: Math.sin(a), z: -Math.cos(z) * Math.cos(a), tan: Math.tan(a), hx: Math.sin(z), hz: -Math.cos(z) }; };
  const far = () => { const a = cr(eye), b = cr(target); return Math.hypot((b.c - a.c) * FAR.dx, (b.r - a.r) * FAR.dz); };
  const subjPoint = () => { const t = pick(target), q = far() > 3000 ? snap(t, t.g === NR ? 6 : 4) : null; if (q) return q; return { g: t.g, c: t.c, r: t.r, h: gh(t.g, t.c, t.r) + 6 }; };
  const herePoint = () => { const e = pick(eye); return { g: e.g, c: e.c, r: e.r, h: gh(e.g, e.c, e.r) }; };
  // where the camera stands: on the fine grid the highest ground within a step, so a pin on a steep slope does not put the eye inside the hill
  const eyeH = e => { let h = gh(e.g, e.c, e.r); if (e.g === NR) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) h = Math.max(h, gh(e.g, e.c + a * 1.5, e.r + b * 1.5)); return h + 3; };
  // First / last direct light. Measured 12 Nov 2026 against 102 webcam pictures (27 events, tools/sun3d/README.md): with
  // the first rule (whole disc clear of a soft skyline, never below the flat horizon) ridge-blocked events were right to
  // a few minutes but sunrise / sunset on high points were 5-13 min off. Now: the sun's CENTRE against a hard skyline
  // ("half the sun showing"), and a high point sees a little below the flat horizon (0.95 deg x sqrt of its km above the
  // area's low ground). Scored on the picture events: high-point sunrise / sunset 9 of 12 inside the picture window
  // (was 2), ridge-blocked 4 of 4 at +2 min. The sun's top edge scored 10 of 12 but put ridge events +3.3 min late.
  const dipOf = h => 0.95 * Math.sqrt(Math.max(0, h - baseH) / 1000);
  const lit = (p, az, alt) => { if (alt <= -dipOf(p.h)) return false; const v = sunVec(az, alt); return vis(p, v.hx, v.hz, v.tan) > 0; };

  const KEY = [
    [-18, [1, .5, .3], 0, [.030, .036, .060], [.010, .014, .035], [.030, .040, .080]], [-8, [1, .5, .3], 0, [.085, .105, .180], [.050, .075, .190], [.200, .190, .300]],
    [-3, [1, .45, .3], 0, [.200, .220, .330], [.110, .170, .380], [.780, .470, .400]], [0, [1, .47, .28], .55, [.270, .290, .400], [.170, .270, .520], [.950, .620, .430]],
    [3, [1, .62, .40], .85, [.300, .340, .460], [.200, .330, .620], [.960, .760, .580]], [8, [1, .82, .64], 1.0, [.310, .370, .500], [.200, .380, .720], [.820, .840, .880]],
    [16, [1, .93, .82], 1.05, [.320, .390, .530], [.190, .400, .780], [.720, .820, .920]], [30, [1, .97, .92], 1.1, [.330, .400, .540], [.180, .400, .800], [.700, .810, .930]]];
  function atmo(alt) {
    let a = KEY[0], b = KEY[KEY.length - 1];
    for (let i = 0; i < KEY.length - 1; i++) if (alt >= KEY[i][0] && alt <= KEY[i + 1][0]) { a = KEY[i]; b = KEY[i + 1]; break; }
    if (alt <= KEY[0][0]) b = a; if (alt >= b[0]) a = b;
    const t = a === b ? 0 : (alt - a[0]) / (b[0] - a[0]), m = (p, q) => p.map((v, i) => v + (q[i] - v) * t);
    return { sun: m(a[1], b[1]), sunI: a[2] + (b[2] - a[2]) * t, amb: m(a[3], b[3]), zen: m(a[4], b[4]), hor: m(a[5], b[5]) };
  }

  const LIGHT_FS = `
    precision highp float;
    uniform sampler2D hmap; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 amb; uniform vec2 size; uniform float texel; uniform float snowMode; uniform float maxH; uniform float baseH;
    #ifdef NEAR
    uniform sampler2D fmap; uniform vec4 rect; uniform vec2 fsize; uniform float step0; uniform float fcells;
    #endif
    varying vec2 vUv;
    float H(vec2 uv) { vec2 t = texture2D(hmap, uv).rg; return t.r + t.g; }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y); }
    void main() {
      float h = H(vUv);
      float hx = (H(vUv + vec2(texel, 0.)) - H(vUv - vec2(texel, 0.))) / (2. * texel * size.x);
      float hz = (H(vUv + vec2(0., texel)) - H(vUv - vec2(0., texel))) / (2. * texel * size.y);
      vec3 n = normalize(vec3(-hx, 1., -hz));
      float slope = degrees(acos(n.y));
      vec2 g = vUv / texel;
    #ifdef NEAR
      vec2 gp = (rect.xy + vUv * rect.zw) / fsize * fcells;   // patches follow the far grid's cells, so tints and tree patches run on across the box edge
    #else
      vec2 gp = g;
    #endif
      float fine = hash(floor(g)), pch = vnoise(gp / 9.) * .6 + vnoise(gp / 2.5) * .4;
      vec3 alb;
      if (snowMode > .5) {
        float rock = smoothstep(37., 53., slope + fine * 7.);
        float forest = smoothstep(2040., 2110., h) * (1. - smoothstep(2600., 2950., h + pch * 260.)) * smoothstep(3., 8., slope + pch * 4.) * (1. - rock) * smoothstep(.25, .6, pch + fine * .25);
        alb = vec3(.93, .95, .98);
        alb = mix(alb, vec3(.24, .31, .29) + fine * .08, forest * .9);
        alb = mix(alb, vec3(.38, .36, .37) + fine * .06, rock);
      } else {
        float rock = smoothstep(33., 50., slope + fine * 7.);
        vec3 grass = mix(vec3(.25, .36, .16), vec3(.37, .38, .22), smoothstep(120., 620., h + pch * 160.));
        alb = mix(grass + fine * .05, vec3(.34, .32, .31) + fine * .06, rock);
        if (h < .6) alb = vec3(.07, .16, .24);
      }
      float d = 0.;
      if (sunDir.y > -sin(radians(.95) * sqrt(max(0., h - baseH) / 1000.))) {   // a high point still sees a sun just under the flat horizon
        float lam = dot(n, sunDir);
        if (lam > 0.) {
          vec2 dir = normalize(sunDir.xz) / size; float tanA = sunDir.y / length(sunDir.xz);
    #ifdef NEAR
          float L = step0, dist = 0., v = 1.;
          for (int k = 0; k < 128; k++) {
            dist += L; vec2 p = vUv + dir * dist; float hh = h + 3. + tanA * dist;
            if (hh > maxH) break;
            float gr;
            if (p.x < 0. || p.y < 0. || p.x > 1. || p.y > 1.) {
              vec2 q = (rect.xy + p * rect.zw) / fsize;
              if (q.x < 0. || q.y < 0. || q.x > 1. || q.y > 1.) break;
              vec2 t = texture2D(fmap, q).rg; gr = t.r + t.g;
            } else gr = H(p);
            float cl = hh - gr;
            if (cl <= 0.) { v = 0.; break; }
            v = min(v, cl / (dist * .02)); L *= 1.045;
          }
    #else
          float L = 34., dist = 0., v = 1.;
          for (int k = 0; k < 110; k++) {
            dist += L; vec2 p = vUv + dir * dist; float hh = h + 3. + tanA * dist;
            if (p.x < 0. || p.y < 0. || p.x > 1. || p.y > 1. || hh > maxH) break;
            float cl = hh - H(p);
            if (cl <= 0.) { v = 0.; break; }
            v = min(v, cl / (dist * .02)); L *= 1.045;
          }
    #endif
          d = lam * v;
        }
      }
      vec3 c = alb * (amb * (.72 + .28 * n.y) + sunCol * d);
      gl_FragColor = vec4(pow(min(c * .9, vec3(1.)), vec3(.62)), 1.);
    }`;
  // The far mesh. With a near grid (HOLE) it is cut out inside the near box: untouched for the first `keep` metres inside the
  // edge (the near mesh matches it there), then pushed down under the near mesh, and not drawn at all past `band` metres.
  const TERRAIN_VS = `
    uniform sampler2D hmap; uniform vec2 size; varying vec2 vUv; varying float vDist;
    #ifdef HOLE
    uniform vec4 hole; uniform float keep; uniform float band;
    #endif
    void main() {
      vUv = position.xz; vec2 t = texture2D(hmap, vUv).rg; float y = t.r + t.g;
    #ifdef HOLE
      vec2 w = vUv * size; float din = min(min(w.x - hole.x, hole.z - w.x), min(w.y - hole.y, hole.w - w.y));
      y -= clamp(din - keep, 0., band) * .5;
    #endif
      vec4 mv = viewMatrix * vec4(vUv.x * size.x, y, vUv.y * size.y, 1.); vDist = length(mv.xyz); gl_Position = projectionMatrix * mv;
    }`;
  const TERRAIN_FS = `
    precision highp float; uniform sampler2D lmap; uniform vec3 fogCol; uniform float fogD; varying vec2 vUv; varying float vDist;
    #ifdef HOLE
    uniform vec2 size; uniform vec4 hole; uniform float band;
    #endif
    void main() {
    #ifdef HOLE
      vec2 w = vUv * size; if (min(min(w.x - hole.x, hole.z - w.x), min(w.y - hole.y, hole.w - w.y)) > band) discard;
    #endif
      vec3 c = texture2D(lmap, vUv).rgb; float f = 1. - exp(-pow(fogD * vDist, 2.)); gl_FragColor = vec4(mix(c, fogCol, f), 1.);
    }`;
  // The near mesh: its points bunch up around `focus` (the shot), its outer ring hangs down as a skirt, and toward the box
  // edge both its heights and its colours fade into the far grid's, so the two meshes meet without a step.
  const NEAR_VS = `
    uniform sampler2D hmap; uniform sampler2D fmap; uniform vec4 rect; uniform vec2 fsize; uniform vec2 focus; uniform float keep; uniform float band;
    varying vec2 vUv; varying vec2 vF; varying float vT; varying float vDist;
    float wp(float s, float f) { float d = s - f; float m = d < 0. ? f : 1. - f; if (m < .0005) return f; float x = abs(d) / m; return f + sign(d) * m * x * (.35 + .65 * x * x); }
    void main() {
      vec2 uv = vec2(wp(position.x, focus.x), wp(position.z, focus.y));
      vec2 w = rect.xy + uv * rect.zw; vUv = uv; vF = w / fsize;
      float din = min(min(uv.x, 1. - uv.x) * rect.z, min(uv.y, 1. - uv.y) * rect.w);
      vT = smoothstep(keep, band, din);
      vec2 a = texture2D(hmap, uv).rg; vec2 b = texture2D(fmap, vF).rg;
      float y = mix(b.r + b.g, a.r + a.g, vT) - position.y * 90.;
      vec4 mv = viewMatrix * vec4(w.x, y, w.y, 1.); vDist = length(mv.xyz); gl_Position = projectionMatrix * mv;
    }`;
  const NEAR_FS = `
    precision highp float; uniform sampler2D lmap; uniform sampler2D flmap; uniform vec3 fogCol; uniform float fogD; varying vec2 vUv; varying vec2 vF; varying float vT; varying float vDist;
    void main() { vec3 c = mix(texture2D(flmap, vF).rgb, texture2D(lmap, vUv).rgb, vT); float f = 1. - exp(-pow(fogD * vDist, 2.)); gl_FragColor = vec4(mix(c, fogCol, f), 1.); }`;

  async function decode(list, n, base, step) {
    let len = 0; const bins = list.map(s => { const b = atob(s); len += b.length; return b; });
    const buf = new Uint8Array(len); let o = 0;
    for (const b of bins) { for (let i = 0; i < b.length; i++) buf[o + i] = b.charCodeAt(i); o += b.length; }
    const dv = new DataView(buf.buffer), idat = []; o = 8;
    while (o < buf.length) { const l = dv.getUint32(o), type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]); if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + l)); o += 12 + l; }
    const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
    if (raw.length !== n * (2 * n + 1)) throw new Error('terrain file has the wrong size');
    const q = new Uint16Array(n * n), HF = new Float32Array(n * n); let hi = -1e9;
    for (let r = 0, p = 0; r < n; r++) {
      p++;
      for (let c = 0; c < n; c++, p += 2) {
        const i = r * n + c, res = (raw[p] << 8) | raw[p + 1];
        q[i] = (res + (c ? q[i - 1] : 0) + (r ? q[i - n] : 0) - (r && c ? q[i - n - 1] : 0)) & 65535;
        const h = base + q[i] * step; HF[i] = h; if (h > hi) hi = h;
      }
    }
    return { HF, hi };
  }
  async function load() {
    const f = await decode(parts, cfg.n, cfg.base, cfg.step); parts = [];
    FAR = { n: cfg.n, HF: f.HF, north: cfg.north, south: cfg.south, west: cfg.west, east: cfg.east, x0: 0, z0: 0, w: cfg.W, d: cfg.D, dx: cfg.W / cfg.n, dz: cfg.D / cfg.n };
    maxH = f.hi + 60; NR = null;
    { const s = []; for (let i = 0; i < f.HF.length; i += 37) s.push(f.HF[i]); s.sort((a, b) => a - b); baseH = s[Math.floor(s.length * 0.1)] || 0; }   // the area's low ground: valley floor, or the sea
    const nc = cfg.near, list = nparts; nparts = [];
    if (!nc || !list.length) return;
    try {   // the fine grid is an extra: if its file is bad the wide one still draws
      const m = await decode(list, nc.n, nc.base || 0, nc.step || 0.5), kx = cfg.W / (cfg.east - cfg.west), kz = cfg.D / (cfg.north - cfg.south);
      const w = (nc.east - nc.west) * kx, d = (nc.north - nc.south) * kz, cell = Math.max(cfg.W, cfg.D) / (G - 1);
      if (!(nc.west >= cfg.west && nc.east <= cfg.east && nc.south >= cfg.south && nc.north <= cfg.north) || Math.min(w, d) < 12 * cell) throw new Error('near grid does not fit');
      NR = { n: nc.n, HF: m.HF, north: nc.north, south: nc.south, west: nc.west, east: nc.east, x0: (nc.west - cfg.west) * kx, z0: (cfg.north - nc.north) * kz, w, d, dx: w / nc.n, dz: d / nc.n, keep: 1.6 * cell, band: 4.2 * cell };
      maxH = Math.max(maxH, m.hi + 60);
    } catch (e) { NR = null; post({ type: 'near', ok: false, msg: String(e && e.message || e) }); }
  }

  function heightTex(g) {
    const n = g.n, half = new Uint16Array(n * n * 2);
    for (let i = 0; i < n * n; i++) { const base = Math.floor(g.HF[i] / 64) * 64; half[i * 2] = THREE.DataUtils.toHalfFloat(base); half[i * 2 + 1] = THREE.DataUtils.toHalfFloat(g.HF[i] - base); }
    const hmap = new THREE.DataTexture(half, n, n, THREE.RGFormat, THREE.HalfFloatType);
    hmap.internalFormat = 'RG16F'; hmap.magFilter = hmap.minFilter = THREE.LinearFilter; hmap.wrapS = hmap.wrapT = THREE.ClampToEdgeWrapping; hmap.needsUpdate = true;
    return hmap;
  }
  function build() {
    const canvas = document.getElementById('view');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) throw new Error('no WebGL2');
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const N = FAR.n, hmap = heightTex(FAR);
    const size = new THREE.Vector2(FAR.w, FAR.d);
    const rt = n => { const t = new THREE.WebGLRenderTarget(n, n, { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false }); t.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return t; };
    const lo = rt(Math.min(1024, N)), hi = rt(N);
    const sunU = { sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Vector3() }, amb: { value: new THREE.Vector3() }, snowMode: { value: cfg.ground === 'green' ? 0 : 1 }, maxH: { value: maxH }, baseH: { value: baseH } };
    const lightVS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
    const lightMat = new THREE.ShaderMaterial({ uniforms: { hmap: { value: hmap }, sunDir: sunU.sunDir, sunCol: sunU.sunCol, amb: sunU.amb, size: { value: size }, texel: { value: 1 / N }, snowMode: sunU.snowMode, maxH: sunU.maxH, baseH: sunU.baseH }, vertexShader: lightVS, fragmentShader: LIGHT_FS, depthTest: false, depthWrite: false });
    const lightScene = new THREE.Scene(), lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lightMat); quad.frustumCulled = false; lightScene.add(quad);

    const pos = new Float32Array(G * G * 3);
    for (let j = 0, k = 0; j < G; j++) for (let i = 0; i < G; i++) { pos[k++] = i / (G - 1); pos[k++] = 0; pos[k++] = j / (G - 1); }
    const idx = new Uint32Array((G - 1) * (G - 1) * 6); let m = 0;
    for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) { const a = j * G + i, b = a + 1, d = a + G, e = d + 1; idx[m++] = a; idx[m++] = d; idx[m++] = b; idx[m++] = b; idx[m++] = d; idx[m++] = e; }
    const index = new THREE.BufferAttribute(idx, 1);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(index);
    const fog = { fogCol: { value: new THREE.Vector3() }, fogD: { value: 0.000011 } };
    const terrU = { hmap: { value: hmap }, lmap: { value: lo.texture }, size: { value: size }, fogCol: fog.fogCol, fogD: fog.fogD };
    let near = null;
    if (NR) {
      const nmap = heightTex(NR), rect = new THREE.Vector4(NR.x0, NR.z0, NR.w, NR.d);
      const nLight = new THREE.ShaderMaterial({ defines: { NEAR: 1 }, uniforms: { hmap: { value: nmap }, fmap: { value: hmap }, rect: { value: rect }, fsize: { value: size }, step0: { value: 1.2 * Math.max(NR.dx, NR.dz) }, fcells: { value: FAR.n }, sunDir: sunU.sunDir, sunCol: sunU.sunCol, amb: sunU.amb, size: { value: new THREE.Vector2(NR.w, NR.d) }, texel: { value: 1 / NR.n }, snowMode: sunU.snowMode, maxH: sunU.maxH, baseH: sunU.baseH }, vertexShader: lightVS, fragmentShader: LIGHT_FS, depthTest: false, depthWrite: false });
      // the same triangles as the far mesh; the outer ring of points is the skirt (y = 1), the next ring is the box edge
      const np = new Float32Array(G * G * 3), sk = i => (i === 0 || i === G - 1 ? 1 : 0), at = i => Math.max(0, Math.min(1, (i - 1) / (G - 3)));
      for (let j = 0, k = 0; j < G; j++) for (let i = 0; i < G; i++) { np[k++] = at(i); np[k++] = sk(i) || sk(j); np[k++] = at(j); }
      const ngeo = new THREE.BufferGeometry(); ngeo.setAttribute('position', new THREE.BufferAttribute(np, 3)); ngeo.setIndex(index);
      const nlo = rt(Math.min(1024, NR.n)), nhi = rt(NR.n);
      const mat = new THREE.ShaderMaterial({ uniforms: { hmap: { value: nmap }, fmap: { value: hmap }, lmap: { value: nlo.texture }, flmap: { value: lo.texture }, rect: { value: rect }, fsize: { value: size }, focus: { value: new THREE.Vector2(0.5, 0.5) }, keep: { value: NR.keep }, band: { value: NR.band }, fogCol: fog.fogCol, fogD: fog.fogD }, vertexShader: NEAR_VS, fragmentShader: NEAR_FS });
      const mesh = new THREE.Mesh(ngeo, mat); mesh.frustumCulled = false;
      near = { lightMat: nLight, lo: nlo, hi: nhi, mat, mesh };
      terrU.hole = { value: new THREE.Vector4(NR.x0, NR.z0, NR.x0 + NR.w, NR.z0 + NR.d) }; terrU.keep = { value: NR.keep }; terrU.band = { value: NR.band };
    }
    const terrMat = new THREE.ShaderMaterial({ defines: near ? { HOLE: 1 } : {}, uniforms: terrU, vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS });
    if (near) {   // two grids are a lot for a phone: let go of the copies the graphics card now holds
      const drop = function () { this.array = null; }; index.onUpload(drop); geo.attributes.position.onUpload(drop); near.mesh.geometry.attributes.position.onUpload(drop);
      for (const t of [hmap, near.mat.uniforms.hmap.value]) t.onUpdate = () => { t.image = { data: null, width: t.image.width, height: t.image.height }; t.onUpdate = null; };
    }
    const scene = new THREE.Scene(), terrain = new THREE.Mesh(geo, terrMat); terrain.frustumCulled = false; scene.add(terrain);
    if (near) scene.add(near.mesh);
    const cam = new THREE.PerspectiveCamera(27, 1.5, near ? 2 : 4, 260000); cam.rotation.order = 'YXZ';
    const skyGeo = new THREE.SphereGeometry(200000, 48, 24), skyPos = skyGeo.attributes.position, skyCol = new THREE.BufferAttribute(new Float32Array(skyPos.count * 3), 3); skyGeo.setAttribute('color', skyCol);
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })); sky.frustumCulled = false; scene.add(sky);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2100, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    const halo = new THREE.Mesh(new THREE.CircleGeometry(9000, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.22, depthWrite: false }));
    scene.add(halo); scene.add(disc);
    R = { renderer, canvas, lo, hi, lightMat, quad, lightScene, lightCam, terrMat, near, scene, cam, sky, skyPos, skyCol, disc, halo, sv: sunVec(180, 20) };
  }

  function lightPass(full) {
    const r = R.renderer, t = full ? R.hi : R.lo;
    R.quad.material = R.lightMat; r.setRenderTarget(t); r.render(R.lightScene, R.lightCam);
    R.terrMat.uniforms.lmap.value = t.texture;
    if (R.near) {
      const nt = full ? R.near.hi : R.near.lo;
      R.quad.material = R.near.lightMat; r.setRenderTarget(nt); r.render(R.lightScene, R.lightCam);
      R.near.mat.uniforms.lmap.value = nt.texture; R.near.mat.uniforms.flmap.value = t.texture;
    }
    r.setRenderTarget(null);
  }
  function light() {
    const v = sunVec(sun.az, sun.alt), A = atmo(sun.alt); R.sv = v;
    R.lightMat.uniforms.sunDir.value.set(v.x, v.y, v.z);
    R.lightMat.uniforms.sunCol.value.set(A.sun[0] * A.sunI, A.sun[1] * A.sunI, A.sun[2] * A.sunI);
    R.lightMat.uniforms.amb.value.set(A.amb[0], A.amb[1], A.amb[2]);
    lightPass(false);   // quick pass while the time is moving, the full one once it rests
    clearTimeout(hiTimer); hiTimer = setTimeout(() => { if (R) { lightPass(true); dirty = true; } }, 260);
    const glow = sun.alt > -10 ? Math.max(0, 1 - Math.abs(sun.alt - 2) / 16) : 0, sp = R.skyPos;
    for (let j = 0; j < sp.count; j++) {
      const x = sp.getX(j) / 200000, y = sp.getY(j) / 200000, z = sp.getZ(j) / 200000;
      const t = Math.pow(Math.max(0, y), 0.45), g = Math.pow(Math.max(0, x * v.x + y * v.y + z * v.z), 10) * glow;
      R.skyCol.setXYZ(j, Math.min(1, A.hor[0] + (A.zen[0] - A.hor[0]) * t + g * 0.9), Math.min(1, A.hor[1] + (A.zen[1] - A.hor[1]) * t + g * 0.55), Math.min(1, A.hor[2] + (A.zen[2] - A.hor[2]) * t + g * 0.25));
    }
    R.skyCol.needsUpdate = true;
    R.terrMat.uniforms.fogCol.value.set(A.hor[0], A.hor[1], A.hor[2]);
    R.disc.visible = R.halo.visible = sun.alt > -1;
    R.disc.material.color.setRGB(1, Math.min(1, .75 + A.sun[1] * .25), Math.min(1, .5 + A.sun[2] * .5));
    R.halo.material.color.setRGB(A.sun[0], A.sun[1], A.sun[2]);
    post({ type: 'state', subjectLit: lit(subjPoint(), sun.az, sun.alt), hereLit: lit(herePoint(), sun.az, sun.alt), up: sun.alt > 0 });
  }
  function aim() {
    const a = cr(eye), b = cr(target), dx = (b.c - a.c) * FAR.dx, dz = (b.r - a.r) * FAR.dz, dist = Math.hypot(dx, dz);
    yaw = dist > 5 ? Math.atan2(dx, -dz) : 0;
    const e = pick(eye), t = pick(target), up = eyeH(e);
    if (dist > 3000 || t.g !== NR) {
      const top = dist > 3000 ? Math.atan2(snap(t, t.g === NR ? 6 : 4).h - up, dist) : 0.04;
      pitch = Math.max(0.01, top * 0.45);
    } else pitch = Math.max(-0.6, Math.min(0.6, Math.atan2(gh(t.g, t.c, t.r) + 6 - up, Math.max(dist, 20))));   // a close subject on the fine grid: look straight at it, up or down
    if (R && R.near) {   // the near mesh is densest a little past the middle of the shot; with the subject outside the box (a far peak), around the feet and a little ahead
      const p = crg(NR, eye), q = crg(NR, target), k = t.g === NR ? 0.6 : Math.min(0.6, 250 / Math.max(dist, 1));
      R.near.mat.uniforms.focus.value.set(Math.max(0, Math.min(1, (p.c + (q.c - p.c) * k + 0.5) / NR.n)), Math.max(0, Math.min(1, (p.r + (q.r - p.r) * k + 0.5) / NR.n)));
    }
  }
  // The lens: focal length and the film's width and height in mm as the camera is turned (4x5 landscape = 120 x 96).
  // The view is drawn a little wider than the lens, so the whole frame shows with a margin and the box marks it.
  // Exact for a lens focused far away with no rise, fall or shift.
  function lensFov() {
    const a = (R && R.cam.aspect) || ((window.innerWidth || 1) / (window.innerHeight || 1));
    const th = lens.fw / (2 * lens.f), tv = lens.fh / (2 * lens.f), k = Math.max(th / (a * 0.9), tv / 0.9);
    const el = document.getElementById('frame');
    if (el) { el.style.display = lens.box ? 'block' : 'none'; el.style.width = (th / (k * a) * 100) + '%'; el.style.height = (tv / k * 100) + '%'; }
    return 2 * Math.atan(k);
  }
  function place() {
    const q = cr(eye), e = pick(eye), cam = R.cam;
    cam.position.set((q.c + 0.5) * FAR.dx, eyeH(e), (q.r + 0.5) * FAR.dz); cam.rotation.set(pitch, -yaw, 0);
    cam.fov = lensFov() * 180 / Math.PI; cam.updateProjectionMatrix(); R.sky.position.copy(cam.position);
  }
  function resize() { const w = window.innerWidth, h = window.innerHeight; if (!R || !w || !h) return; R.renderer.setSize(w, h, false); R.cam.aspect = w / h; dirty = true; }
  function tick() {
    if (R && dirty) {
      if (relight) { light(); relight = false; }
      place();
      const cam = R.cam, v = R.sv;
      for (const o of [R.disc, R.halo]) { o.position.set(cam.position.x + v.x * 190000, cam.position.y + v.y * 190000, cam.position.z + v.z * 190000); o.lookAt(cam.position); }
      R.renderer.render(R.scene, cam); dirty = false;
    }
    requestAnimationFrame(tick);
  }
  function inside(p) { return p && p.lat <= cfg.north && p.lat >= cfg.south && p.lng >= cfg.west && p.lng <= cfg.east; }
  function heading() { post({ type: 'look', deg: Math.round(((yaw * 180 / Math.PI) % 360 + 360) % 360) }); }

  const WALK_MAX = 400;
  function told() {
    const kz = 111132, kx = 111320 * Math.cos(eye.lat * Math.PI / 180);
    post({ type: 'eye', lat: eye.lat, lng: eye.lng, moved: Math.round(Math.hypot((eye.lat - eye0.lat) * kz, (eye.lng - eye0.lng) * kx)) });
    post({ type: 'state', subjectLit: lit(subjPoint(), sun.az, sun.alt), hereLit: lit(herePoint(), sun.az, sun.alt), up: sun.alt > 0 });
  }
  let drag = null;
  function wire() {
    const c = R.canvas;
    c.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; try { c.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } });
    c.addEventListener('pointermove', e => { if (!drag) return; const per = (R.cam.fov * Math.PI / 180) / window.innerHeight; yaw -= (e.clientX - drag.x) * per; if (!inline) pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - drag.y) * per)); drag = { x: e.clientX, y: e.clientY }; dirty = true; });
    const drop = () => { if (drag) { drag = null; heading(); } };
    c.addEventListener('pointerup', drop); c.addEventListener('pointercancel', drop);
    window.addEventListener('resize', resize);
  }

  window.S3D = {
    init(c) { cfg = c; parts = []; nparts = []; eye = c.eye; eye0 = c.eye; target = c.target; focal = c.focal || 50; if (c.lens) lens = Object.assign({}, lens, c.lens); inline = !!c.inline; { const cv = document.getElementById('view'); if (cv) cv.style.touchAction = inline ? 'pan-y' : 'none'; } },
    chunk(s, which) { (which === 'near' ? nparts : parts).push(s); },
    async done() {
      try {
        if (typeof DecompressionStream === 'undefined') return fail("This phone's web view is too old for the 3D view.");
        if (!inside(eye)) return fail('This spot is outside the 3D terrain for the area.');
        await load(); build(); aim(); wire(); resize(); say(''); relight = dirty = true; requestAnimationFrame(tick);
        post({ type: 'ready', n: FAR.n, gl: 'webgl2', near: NR ? NR.n : 0 }); heading();
      } catch (e) { fail("The 3D view couldn't start on this phone."); post({ type: 'error', msg: String(e && e.message || e) }); }
    },
    sun(az, alt) { sun = { az, alt }; relight = dirty = true; },
    focal(f) { lens = Object.assign({}, lens, { f }); dirty = true; },
    // lens({ f, fw, fh, box }): focal length, film width / height in mm as the camera is turned, frame box on / off
    lens(o) { lens = Object.assign({}, lens, o || {}); dirty = true; },
    // inline(true): the small view inside a scrolling page. A sideways drag looks around; up-down drags are left to the
    // page (touch-action pan-y), so the two no longer fight. Full screen: free look both ways.
    inline(v) { inline = !!v; const c = document.getElementById('view'); if (c) c.style.touchAction = inline ? 'pan-y' : 'none'; },
    view(eLat, eLng, tLat, tLng) { eye = { lat: eLat, lng: eLng }; eye0 = eye; target = { lat: tLat, lng: tLng }; if (!R) return; if (!inside(eye)) return fail('This spot is outside the 3D terrain for the area.'); say(''); aim(); relight = dirty = true; heading(); },
    recenter() { if (R) { aim(); dirty = true; heading(); } },
    // Walk mode (12 Nov 2026): step the viewpoint f metres forward and r metres to the right of where the view is
    // looking, on the ground, at most WALK_MAX metres from the shot's own stand spot. The app is told where the
    // viewpoint now is ('eye') and whether that spot is in the sun; it asks for the day's first / last light again
    // (path) when the walking stops. home() goes back to the stand spot.
    walk(f, r) {
      if (!R || !eye || !eye0) return;
      const kz = 111132, kx = 111320 * Math.cos(eye.lat * Math.PI / 180);
      const de = Math.sin(yaw) * f + Math.cos(yaw) * r, dn = Math.cos(yaw) * f - Math.sin(yaw) * r;
      const next = { lat: eye.lat + dn / kz, lng: eye.lng + de / kx };
      const off = Math.hypot((next.lat - eye0.lat) * kz, (next.lng - eye0.lng) * kx);
      if (!inside(next) || off > WALK_MAX) { post({ type: 'walk', stopped: inside(next) ? 'far' : 'edge', max: WALK_MAX }); return; }
      eye = next; dirty = true; told();
    },
    home() { if (!R || !eye0) return; eye = eye0; aim(); dirty = true; heading(); told(); },
    path(arr) {
      if (!R) return;
      const s = subjPoint(), h = herePoint(); let fs = null, ls = null, fh = null, lh = null;
      for (const [m, az, alt] of arr) { if (lit(s, az, alt)) { if (fs == null) fs = m; ls = m; } if (lit(h, az, alt)) { if (fh == null) fh = m; lh = m; } }
      post({ type: 'moments', firstSubject: fs, lastSubject: ls, firstHere: fh, lastHere: lh });
    },
  };
  post({ type: 'boot' });
})();
