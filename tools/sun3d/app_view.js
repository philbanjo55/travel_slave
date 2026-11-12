// The 3D sun view that runs inside the app's web view (TEST app, stop page, Sun & Moon -> 3D).
// The app drives it through window.S3D; it answers with window.ReactNativeWebView.postMessage(JSON).
//   S3D.init(cfg)   cfg = { n, north, south, west, east, W, D, base, step, ground, eye:{lat,lng}, target:{lat,lng}, focal }
//   S3D.chunk(b64)  the elevation file, in base64 pieces; then S3D.done()
//   S3D.sun(az, alt)  degrees, from the app's own sun engine      S3D.focal(mm)
//   S3D.view(eyeLat, eyeLng, targetLat, targetLng)                S3D.path([[minute, az, alt], ...]) -> 'moments'
// Built into src/components/sun/sun3dHtml.ts by tools/sun3d/build_app_html.js. Do not edit the generated file.
(function () {
  const post = m => { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) { /* not in the app */ } };
  const say = t => { const m = document.getElementById('msg'); m.textContent = t || ''; m.style.display = t ? 'flex' : 'none'; };
  const fail = t => { say(t); post({ type: 'error', msg: t }); };
  window.onerror = msg => { post({ type: 'error', msg: String(msg) }); };

  let cfg = null, parts = [], HF = null, N = 0, W = 0, D = 0, maxH = 4250, DXm = 1, DZm = 1;
  let R = null;   // everything three.js, once built
  let eye = null, target = null, yaw = 0, pitch = 0, focal = 50, sun = { az: 180, alt: 20 }, dirty = true, relight = true, hiTimer = null;

  const hB = (c, r) => {
    c = Math.max(0, Math.min(N - 1.001, c)); r = Math.max(0, Math.min(N - 1.001, r));
    const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, i = r0 * N + c0;
    return (HF[i] * (1 - fc) + HF[i + 1] * fc) * (1 - fr) + (HF[i + N] * (1 - fc) + HF[i + N + 1] * fc) * fr;
  };
  const cr = p => ({ c: (p.lng - cfg.west) / (cfg.east - cfg.west) * N - 0.5, r: (cfg.north - p.lat) / (cfg.north - cfg.south) * N - 0.5 });
  function vis(c, r, h, ux, uz, tanA) {
    let L = 30, d = 0, v = 1;
    for (let k = 0; k < 260; k++) {
      d += L; const cc = c + ux * d / DXm, rr = r + uz * d / DZm, hh = h + 3 + tanA * d;
      if (cc < 0 || rr < 0 || cc > N - 1 || rr > N - 1 || hh > maxH) break;
      const cl = hh - hB(cc, rr);
      if (cl <= 0) return 0;
      const s = cl / (d * 0.02); if (s < v) v = s;
      L *= 1.03;
    }
    return v;
  }
  // the highest grid point close to a pin: a summit pin a few metres off would sit in the summit's own shadow
  const snap = (p, rad) => { const q = cr(p); let best = null; for (let r = Math.round(q.r) - rad; r <= Math.round(q.r) + rad; r++) for (let c = Math.round(q.c) - rad; c <= Math.round(q.c) + rad; c++) { if (r < 0 || c < 0 || r >= N || c >= N) continue; const h = HF[r * N + c]; if (!best || h > best.h) best = { c, r, h }; } return best; };
  const sunVec = (az, alt) => { const a = alt * Math.PI / 180, z = az * Math.PI / 180; return { x: Math.sin(z) * Math.cos(a), y: Math.sin(a), z: -Math.cos(z) * Math.cos(a), tan: Math.tan(a), hx: Math.sin(z), hz: -Math.cos(z) }; };
  const far = () => { const a = cr(eye), b = cr(target); return Math.hypot((b.c - a.c) * DXm, (b.r - a.r) * DZm); };
  const subjPoint = () => { const q = far() > 3000 ? snap(target, 4) : null; if (q) return q; const c = cr(target); return { c: c.c, r: c.r, h: hB(c.c, c.r) + 6 }; };
  const herePoint = () => { const c = cr(eye); return { c: c.c, r: c.r, h: hB(c.c, c.r) }; };
  const lit = (p, az, alt) => { if (alt <= 0) return false; const v = sunVec(az, alt); return vis(p.c, p.r, p.h, v.hx, v.hz, v.tan) > 0.5; };

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
    uniform sampler2D hmap; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 amb; uniform vec2 size; uniform float texel; uniform float snowMode; uniform float maxH;
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
      float fine = hash(floor(g)), pch = vnoise(g / 9.) * .6 + vnoise(g / 2.5) * .4;
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
      if (sunDir.y > 0.) {
        float lam = dot(n, sunDir);
        if (lam > 0.) {
          vec2 dir = normalize(sunDir.xz) / size; float tanA = sunDir.y / length(sunDir.xz);
          float L = 34., dist = 0., v = 1.;
          for (int k = 0; k < 110; k++) {
            dist += L; vec2 p = vUv + dir * dist; float hh = h + 3. + tanA * dist;
            if (p.x < 0. || p.y < 0. || p.x > 1. || p.y > 1. || hh > maxH) break;
            float cl = hh - H(p);
            if (cl <= 0.) { v = 0.; break; }
            v = min(v, cl / (dist * .02)); L *= 1.045;
          }
          d = lam * v;
        }
      }
      vec3 c = alb * (amb * (.72 + .28 * n.y) + sunCol * d);
      gl_FragColor = vec4(pow(min(c * .9, vec3(1.)), vec3(.62)), 1.);
    }`;
  const TERRAIN_VS = `
    uniform sampler2D hmap; uniform vec2 size; varying vec2 vUv; varying float vDist;
    void main() { vUv = position.xz; vec2 t = texture2D(hmap, vUv).rg; vec4 mv = viewMatrix * vec4(vUv.x * size.x, t.r + t.g, vUv.y * size.y, 1.); vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }`;
  const TERRAIN_FS = `
    precision highp float; uniform sampler2D lmap; uniform vec3 fogCol; uniform float fogD; varying vec2 vUv; varying float vDist;
    void main() { vec3 c = texture2D(lmap, vUv).rgb; float f = 1. - exp(-pow(fogD * vDist, 2.)); gl_FragColor = vec4(mix(c, fogCol, f), 1.); }`;

  async function decode() {
    let len = 0; const bins = parts.map(s => { const b = atob(s); len += b.length; return b; }); parts = [];
    const buf = new Uint8Array(len); let o = 0;
    for (const b of bins) { for (let i = 0; i < b.length; i++) buf[o + i] = b.charCodeAt(i); o += b.length; }
    const dv = new DataView(buf.buffer), idat = []; o = 8;
    while (o < buf.length) { const l = dv.getUint32(o), type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]); if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + l)); o += 12 + l; }
    const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
    if (raw.length !== N * (2 * N + 1)) throw new Error('terrain file has the wrong size');
    const q = new Uint16Array(N * N); HF = new Float32Array(N * N); let hi = -1e9;
    for (let r = 0, p = 0; r < N; r++) {
      p++;
      for (let c = 0; c < N; c++, p += 2) {
        const i = r * N + c, res = (raw[p] << 8) | raw[p + 1];
        q[i] = (res + (c ? q[i - 1] : 0) + (r ? q[i - N] : 0) - (r && c ? q[i - N - 1] : 0)) & 65535;
        const h = cfg.base + q[i] * cfg.step; HF[i] = h; if (h > hi) hi = h;
      }
    }
    maxH = hi + 60;
  }

  function build() {
    const canvas = document.getElementById('view');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) throw new Error('no WebGL2');
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const half = new Uint16Array(N * N * 2);
    for (let i = 0; i < N * N; i++) { const base = Math.floor(HF[i] / 64) * 64; half[i * 2] = THREE.DataUtils.toHalfFloat(base); half[i * 2 + 1] = THREE.DataUtils.toHalfFloat(HF[i] - base); }
    const hmap = new THREE.DataTexture(half, N, N, THREE.RGFormat, THREE.HalfFloatType);
    hmap.internalFormat = 'RG16F'; hmap.magFilter = hmap.minFilter = THREE.LinearFilter; hmap.wrapS = hmap.wrapT = THREE.ClampToEdgeWrapping; hmap.needsUpdate = true;
    const size = new THREE.Vector2(W, D);
    const rt = n => { const t = new THREE.WebGLRenderTarget(n, n, { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false }); t.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return t; };
    const lo = rt(Math.min(1024, N)), hi = rt(N);
    const lightMat = new THREE.ShaderMaterial({ uniforms: { hmap: { value: hmap }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Vector3() }, amb: { value: new THREE.Vector3() }, size: { value: size }, texel: { value: 1 / N }, snowMode: { value: cfg.ground === 'green' ? 0 : 1 }, maxH: { value: maxH } }, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: LIGHT_FS, depthTest: false, depthWrite: false });
    const lightScene = new THREE.Scene(), lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lightMat); quad.frustumCulled = false; lightScene.add(quad);

    const G = 768, pos = new Float32Array(G * G * 3);
    for (let j = 0, k = 0; j < G; j++) for (let i = 0; i < G; i++) { pos[k++] = i / (G - 1); pos[k++] = 0; pos[k++] = j / (G - 1); }
    const idx = new Uint32Array((G - 1) * (G - 1) * 6); let m = 0;
    for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) { const a = j * G + i, b = a + 1, d = a + G, e = d + 1; idx[m++] = a; idx[m++] = d; idx[m++] = b; idx[m++] = b; idx[m++] = d; idx[m++] = e; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const terrMat = new THREE.ShaderMaterial({ uniforms: { hmap: { value: hmap }, lmap: { value: lo.texture }, size: { value: size }, fogCol: { value: new THREE.Vector3() }, fogD: { value: 0.000011 } }, vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS });
    const scene = new THREE.Scene(), terrain = new THREE.Mesh(geo, terrMat); terrain.frustumCulled = false; scene.add(terrain);
    const cam = new THREE.PerspectiveCamera(27, 1.5, 4, 260000); cam.rotation.order = 'YXZ';
    const skyGeo = new THREE.SphereGeometry(200000, 48, 24), skyPos = skyGeo.attributes.position, skyCol = new THREE.BufferAttribute(new Float32Array(skyPos.count * 3), 3); skyGeo.setAttribute('color', skyCol);
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })); sky.frustumCulled = false; scene.add(sky);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2100, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    const halo = new THREE.Mesh(new THREE.CircleGeometry(9000, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.22, depthWrite: false }));
    scene.add(halo); scene.add(disc);
    R = { renderer, canvas, lo, hi, lightMat, lightScene, lightCam, terrMat, scene, cam, sky, skyPos, skyCol, disc, halo, sv: sunVec(180, 20) };
  }

  function lightPass(target) {
    R.renderer.setRenderTarget(target); R.renderer.render(R.lightScene, R.lightCam); R.renderer.setRenderTarget(null);
    R.terrMat.uniforms.lmap.value = target.texture;
  }
  function light() {
    const v = sunVec(sun.az, sun.alt), A = atmo(sun.alt); R.sv = v;
    R.lightMat.uniforms.sunDir.value.set(v.x, v.y, v.z);
    R.lightMat.uniforms.sunCol.value.set(A.sun[0] * A.sunI, A.sun[1] * A.sunI, A.sun[2] * A.sunI);
    R.lightMat.uniforms.amb.value.set(A.amb[0], A.amb[1], A.amb[2]);
    lightPass(R.lo);   // quick pass while the time is moving, the full one once it rests
    clearTimeout(hiTimer); hiTimer = setTimeout(() => { if (R) { lightPass(R.hi); dirty = true; } }, 260);
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
    const a = cr(eye), b = cr(target), dx = (b.c - a.c) * DXm, dz = (b.r - a.r) * DZm, dist = Math.hypot(dx, dz);
    yaw = dist > 5 ? Math.atan2(dx, -dz) : 0;
    const top = dist > 3000 ? Math.atan2(snap(target, 4).h - (hB(a.c, a.r) + 3), dist) : 0.04;
    pitch = Math.max(0.01, top * 0.45);
  }
  function place() {
    const q = cr(eye), cam = R.cam;
    cam.position.set((q.c + 0.5) * DXm, hB(q.c, q.r) + 3, (q.r + 0.5) * DZm); cam.rotation.set(pitch, -yaw, 0);
    cam.fov = 2 * Math.atan(12 / focal) * 180 / Math.PI; cam.updateProjectionMatrix(); R.sky.position.copy(cam.position);
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

  let drag = null;
  function wire() {
    const c = R.canvas;
    c.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; try { c.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } });
    c.addEventListener('pointermove', e => { if (!drag) return; const per = (R.cam.fov * Math.PI / 180) / window.innerHeight; yaw -= (e.clientX - drag.x) * per; pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - drag.y) * per)); drag = { x: e.clientX, y: e.clientY }; dirty = true; });
    const drop = () => { if (drag) { drag = null; heading(); } };
    c.addEventListener('pointerup', drop); c.addEventListener('pointercancel', drop);
    window.addEventListener('resize', resize);
  }

  window.S3D = {
    init(c) { cfg = c; parts = []; N = c.n; W = c.W; D = c.D; DXm = W / N; DZm = D / N; eye = c.eye; target = c.target; focal = c.focal || 50; },
    chunk(s) { parts.push(s); },
    async done() {
      try {
        if (typeof DecompressionStream === 'undefined') return fail("This phone's web view is too old for the 3D view.");
        if (!inside(eye)) return fail('This spot is outside the 3D terrain for the area.');
        await decode(); build(); aim(); wire(); resize(); say(''); relight = dirty = true; requestAnimationFrame(tick);
        post({ type: 'ready', n: N, gl: 'webgl2' }); heading();
      } catch (e) { fail("The 3D view couldn't start on this phone."); post({ type: 'error', msg: String(e && e.message || e) }); }
    },
    sun(az, alt) { sun = { az, alt }; relight = dirty = true; },
    focal(f) { focal = f; dirty = true; },
    view(eLat, eLng, tLat, tLng) { eye = { lat: eLat, lng: eLng }; target = { lat: tLat, lng: tLng }; if (!R) return; if (!inside(eye)) return fail('This spot is outside the 3D terrain for the area.'); say(''); aim(); relight = dirty = true; heading(); },
    recenter() { if (R) { aim(); dirty = true; heading(); } },
    path(arr) {
      if (!R) return;
      const s = subjPoint(), h = herePoint(); let fs = null, ls = null, fh = null, lh = null;
      for (const [m, az, alt] of arr) { if (lit(s, az, alt)) { if (fs == null) fs = m; ls = m; } if (lit(h, az, alt)) { if (fh == null) fh = m; lh = m; } }
      post({ type: 'moments', firstSubject: fs, lastSubject: ls, firstHere: fh, lastHere: lh });
    },
  };
  post({ type: 'boot' });
})();
