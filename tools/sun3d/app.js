(function () {
  const N = 2048, NORTH = 43.95, SOUTH = 43.45, WEST = -110.92, EAST = -110.24, W = 54727, D = 55566;
  const $ = id => document.getElementById(id);
  const fail = msg => { $('fail').textContent = msg; $('fail').hidden = false; };
  let HF = null; // heights in metres, row 0 = north edge
  const hB = (c, r) => {
    c = Math.max(0, Math.min(N - 1.001, c)); r = Math.max(0, Math.min(N - 1.001, r));
    const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, i = r0 * N + c0;
    return (HF[i] * (1 - fc) + HF[i + 1] * fc) * (1 - fr) + (HF[i + N] * (1 - fc) + HF[i + N + 1] * fc) * fr;
  };
  const cr = (lat, lng) => ({ c: (lng - WEST) / (EAST - WEST) * N - 0.5, r: (NORTH - lat) / (NORTH - SOUTH) * N - 0.5 });
  const DXm = W / N, DZm = D / N;

  const GRAND = { peak: true, name: 'Grand Teton', lat: 43.7411, lng: -110.8024 };
  const MORAN = { peak: true, name: 'Mount Moran', lat: 43.8350, lng: -110.7765 };
  const STOPS = [
    { id: 'sro', name: 'Snake River Overlook', lat: 43.7537, lng: -110.6241, subj: GRAND },
    { id: 'oxbow', name: 'Oxbow Bend', lat: 43.8662, lng: -110.5477, subj: MORAN },
    { id: 'barn', name: 'T.A. Moulton Barn', lat: 43.6615, lng: -110.6642, subj: GRAND },
    { id: 'glacier', name: 'Glacier View Turnout', lat: 43.6913, lng: -110.6727, subj: GRAND },
    { id: 'above', name: 'From above', lat: 43.745, lng: -110.50, subj: GRAND, up: 2600 },
  ];

  // ---- elevation file: 16-bit PNG holding prediction residuals (see tools/sun3d/build_dem.py)
  async function loadDem() {
    const buf = new Uint8Array(await (await fetch('teton-dem.png')).arrayBuffer());
    const dv = new DataView(buf.buffer); const parts = []; let o = 8;
    while (o < buf.length) { const len = dv.getUint32(o), type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]); if (type === 'IDAT') parts.push(buf.subarray(o + 8, o + 8 + len)); o += 12 + len; }
    const raw = new Uint8Array(await new Response(new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
    const q = new Uint16Array(N * N); HF = new Float32Array(N * N);
    for (let r = 0, p = 0; r < N; r++) {
      p++;
      for (let c = 0; c < N; c++, p += 2) {
        const i = r * N + c, res = (raw[p] << 8) | raw[p + 1];
        const left = c ? q[i - 1] : 0, up = r ? q[i - N] : 0, ul = r && c ? q[i - N - 1] : 0;
        q[i] = (res + left + up - ul) & 65535; HF[i] = 1500 + q[i] / 2;
      }
    }
  }

  // ---- point checks on the CPU (first / last light, where you stand)
  function vis(c, r, h, ux, uz, tanA) {
    let L = 30, d = 0, v = 1;
    for (let k = 0; k < 260; k++) {
      d += L; const cc = c + ux * d / DXm, rr = r + uz * d / DZm, hh = h + 3 + tanA * d;
      if (cc < 0 || rr < 0 || cc > N - 1 || rr > N - 1 || hh > 4250) break;
      const cl = hh - hB(cc, rr);
      if (cl <= 0) return 0;
      const s = cl / (d * 0.02); if (s < v) v = s;
      L *= 1.03;
    }
    return v;
  }
  const snap = p => { if (p.s) return p.s; const q = cr(p.lat, p.lng); let best = null; for (let r = Math.round(q.r) - 10; r <= Math.round(q.r) + 10; r++) for (let c = Math.round(q.c) - 10; c <= Math.round(q.c) + 10; c++) { const h = HF[r * N + c]; if (!best || h > best.h) best = { c, r, h }; } return (p.s = best); };
  const sunVec = s => { const a = s.alt * Math.PI / 180, z = s.az * Math.PI / 180; return { x: Math.sin(z) * Math.cos(a), y: Math.sin(a), z: -Math.cos(z) * Math.cos(a), tan: Math.tan(a), hx: Math.sin(z), hz: -Math.cos(z) }; };
  const litAt = (p, mins) => { const s = sunPos(mins, 43.75, -110.65); if (s.alt <= 0) return 0; const v = sunVec(s), q = p.peak ? snap(p) : cr(p.lat, p.lng); return vis(q.c, q.r, p.peak ? q.h : hB(q.c, q.r), v.hx, v.hz, v.tan); };

  // ---- light and sky colours by sun height (degrees)
  const KEY = [
    [-18, [1, .5, .3], 0, [.030, .036, .060], [.010, .014, .035], [.030, .040, .080]],
    [-8, [1, .5, .3], 0, [.085, .105, .180], [.050, .075, .190], [.200, .190, .300]],
    [-3, [1, .45, .3], 0, [.200, .220, .330], [.110, .170, .380], [.780, .470, .400]],
    [0, [1, .47, .28], .55, [.270, .290, .400], [.170, .270, .520], [.950, .620, .430]],
    [3, [1, .62, .40], .85, [.300, .340, .460], [.200, .330, .620], [.960, .760, .580]],
    [8, [1, .82, .64], 1.0, [.310, .370, .500], [.200, .380, .720], [.820, .840, .880]],
    [16, [1, .93, .82], 1.05, [.320, .390, .530], [.190, .400, .780], [.720, .820, .920]],
    [30, [1, .97, .92], 1.1, [.330, .400, .540], [.180, .400, .800], [.700, .810, .930]],
  ];
  function atmo(alt) {
    let a = KEY[0], b = KEY[KEY.length - 1];
    for (let i = 0; i < KEY.length - 1; i++) if (alt >= KEY[i][0] && alt <= KEY[i + 1][0]) { a = KEY[i]; b = KEY[i + 1]; break; }
    if (alt <= KEY[0][0]) b = a; if (alt >= b[0]) a = b;
    const t = a === b ? 0 : (alt - a[0]) / (b[0] - a[0]), m = (p, q) => p.map((v, i) => v + (q[i] - v) * t);
    return { sun: m(a[1], b[1]), sunI: a[2] + (b[2] - a[2]) * t, amb: m(a[3], b[3]), zen: m(a[4], b[4]), hor: m(a[5], b[5]) };
  }

  const LIGHT_FS = `
    precision highp float;
    uniform sampler2D hmap; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 amb; uniform vec2 size; uniform float texel;
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
      float rock = smoothstep(37., 53., slope + fine * 7.);
      float forest = smoothstep(2040., 2110., h) * (1. - smoothstep(2600., 2950., h + pch * 260.)) * smoothstep(3., 8., slope + pch * 4.) * (1. - rock) * smoothstep(.25, .6, pch + fine * .25);
      vec3 alb = vec3(.93, .95, .98);
      alb = mix(alb, vec3(.24, .31, .29) + fine * .08, forest * .9);
      alb = mix(alb, vec3(.38, .36, .37) + fine * .06, rock);
      float d = 0.;
      if (sunDir.y > 0.) {
        float lam = dot(n, sunDir);
        if (lam > 0.) {
          vec2 dir = normalize(sunDir.xz) / size; float tanA = sunDir.y / length(sunDir.xz);
          float L = 34., dist = 0., v = 1.;
          for (int k = 0; k < 110; k++) {
            dist += L; vec2 p = vUv + dir * dist; float hh = h + 3. + tanA * dist;
            if (p.x < 0. || p.y < 0. || p.x > 1. || p.y > 1. || hh > 4250.) break;
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

  async function start() {
    const canvas = $('view'), frame = $('frame');
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch (e) { return fail("This browser can't draw 3D here. Try opening the page in Chrome or Safari."); }
    if (!renderer.capabilities.isWebGL2) return fail("This browser can't draw 3D here. Try opening the page in Chrome or Safari.");
    try { await loadDem(); } catch (e) { return fail("The terrain file didn't load. Reload the page to try again."); }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    // heights on the GPU: two half-float channels (coarse + remainder) so the card can blend them smoothly
    const half = new Uint16Array(N * N * 2);
    for (let i = 0; i < N * N; i++) { const base = Math.floor(HF[i] / 64) * 64; half[i * 2] = THREE.DataUtils.toHalfFloat(base); half[i * 2 + 1] = THREE.DataUtils.toHalfFloat(HF[i] - base); }
    const hmap = new THREE.DataTexture(half, N, N, THREE.RGFormat, THREE.HalfFloatType);
    hmap.internalFormat = 'RG16F'; hmap.magFilter = hmap.minFilter = THREE.LinearFilter; hmap.wrapS = hmap.wrapT = THREE.ClampToEdgeWrapping; hmap.needsUpdate = true;

    const size = new THREE.Vector2(W, D);
    const lightRT = new THREE.WebGLRenderTarget(N, N, { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false });
    lightRT.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const lightMat = new THREE.ShaderMaterial({ uniforms: { hmap: { value: hmap }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Vector3() }, amb: { value: new THREE.Vector3() }, size: { value: size }, texel: { value: 1 / N } }, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: LIGHT_FS, depthTest: false, depthWrite: false });
    const lightScene = new THREE.Scene(), lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lightMat); quad.frustumCulled = false; lightScene.add(quad);

    // terrain mesh: finer where the range is, coarser on the valley floor
    const lines = (lo, hi) => { const a = [0]; let t = 0; while (t < N) { t += (t >= lo && t < hi) ? 2 : 4; a.push(Math.min(N, t) / N); } return a; };
    const us = lines(40, 800), vs = lines(190, 1450), nu = us.length, nv = vs.length;
    const pos = new Float32Array(nu * nv * 3);
    for (let j = 0, k = 0; j < nv; j++) for (let i = 0; i < nu; i++) { pos[k++] = us[i]; pos[k++] = 0; pos[k++] = vs[j]; }
    const idx = new Uint32Array((nu - 1) * (nv - 1) * 6); let m = 0;
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) { const a = j * nu + i, b = a + 1, d = a + nu, e = d + 1; idx[m++] = a; idx[m++] = d; idx[m++] = b; idx[m++] = b; idx[m++] = d; idx[m++] = e; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const terrMat = new THREE.ShaderMaterial({ uniforms: { hmap: { value: hmap }, lmap: { value: lightRT.texture }, size: { value: size }, fogCol: { value: new THREE.Vector3() }, fogD: { value: 0.000011 } }, vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS });
    const scene = new THREE.Scene(); const terrain = new THREE.Mesh(geo, terrMat); terrain.frustumCulled = false; scene.add(terrain);
    const cam = new THREE.PerspectiveCamera(27, 1.5, 4, 260000); cam.rotation.order = 'YXZ';

    const skyGeo = new THREE.SphereGeometry(200000, 48, 24), skyPos = skyGeo.attributes.position;
    const skyCol = new THREE.BufferAttribute(new Float32Array(skyPos.count * 3), 3); skyGeo.setAttribute('color', skyCol);
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })); sky.frustumCulled = false; scene.add(sky);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2100, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    const halo = new THREE.Mesh(new THREE.CircleGeometry(9000, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.22, depthWrite: false }));
    scene.add(halo); scene.add(disc);

    let stop = STOPS[0], mins = 490, yaw = 0, pitch = 0, focal = 50, dirty = true, relight = true, playing = false, moments = [], sv = null;
    const fmt = t => { t = Math.round(t); const h = Math.floor(t / 60), mm = String(t % 60).padStart(2, '0'); return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'AM' : 'PM'}`; };
    const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8];
    const heading = () => ((yaw * 180 / Math.PI) % 360 + 360) % 360;

    function light() {
      const s = sunPos(mins, 43.75, -110.65), v = sunVec(s), A = atmo(s.alt); sv = v;
      lightMat.uniforms.sunDir.value.set(v.x, v.y, v.z);
      lightMat.uniforms.sunCol.value.set(A.sun[0] * A.sunI, A.sun[1] * A.sunI, A.sun[2] * A.sunI);
      lightMat.uniforms.amb.value.set(A.amb[0], A.amb[1], A.amb[2]);
      renderer.setRenderTarget(lightRT); renderer.render(lightScene, lightCam); renderer.setRenderTarget(null);
      const glow = s.alt > -10 ? Math.max(0, 1 - Math.abs(s.alt - 2) / 16) : 0;
      for (let j = 0; j < skyPos.count; j++) {
        const x = skyPos.getX(j) / 200000, y = skyPos.getY(j) / 200000, z = skyPos.getZ(j) / 200000;
        const t = Math.pow(Math.max(0, y), 0.45), g = Math.pow(Math.max(0, x * v.x + y * v.y + z * v.z), 10) * glow;
        skyCol.setXYZ(j, Math.min(1, A.hor[0] + (A.zen[0] - A.hor[0]) * t + g * 0.9), Math.min(1, A.hor[1] + (A.zen[1] - A.hor[1]) * t + g * 0.55), Math.min(1, A.hor[2] + (A.zen[2] - A.hor[2]) * t + g * 0.25));
      }
      skyCol.needsUpdate = true;
      terrMat.uniforms.fogCol.value.set(A.hor[0], A.hor[1], A.hor[2]);
      disc.visible = halo.visible = s.alt > -1;
      disc.material.color.setRGB(1, Math.min(1, .75 + A.sun[1] * .25), Math.min(1, .5 + A.sun[2] * .5));
      halo.material.color.setRGB(A.sun[0], A.sun[1], A.sun[2]);

      $('clock').textContent = fmt(mins);
      $('sunTxt').textContent = s.alt > 0 ? `Sun ${s.alt.toFixed(0)}° up, to the ${compass(s.az)} (${s.az.toFixed(0)}°)` : s.alt > -6 ? 'Sun is down: twilight' : 'Dark';
      const a = litAt(stop.subj, mins) > 0.5, b = litAt(stop, mins) > 0.5, off = s.alt <= 0 ? (mins > 720 ? 'Sun has gone' : 'No sun yet') : null;
      $('subjK').textContent = stop.subj.name.toUpperCase() + ' SUMMIT';
      $('subjV').textContent = a ? 'In the sun' : off || 'In shadow'; $('subjV').className = 'v' + (a ? ' on' : '');
      $('hereV').textContent = stop.up ? 'In the air' : b ? 'In the sun' : off || 'In shade'; $('hereV').className = 'v' + (b && !stop.up ? ' on' : '');
    }
    function place() {
      const q = cr(stop.lat, stop.lng), y = hB(q.c, q.r) + (stop.up || 3);
      cam.position.set((q.c + 0.5) * DXm, y, (q.r + 0.5) * DZm); cam.rotation.set(pitch, -yaw, 0);
      cam.fov = 2 * Math.atan(12 / focal) * 180 / Math.PI; cam.updateProjectionMatrix(); sky.position.copy(cam.position);
      const deg = heading();
      $('capL').textContent = stop.name; $('capR').textContent = `Looking ${compass(deg)} ${deg.toFixed(0)}° · ${focal} mm`;
    }
    function links() {
      const g = cr(stop.lat, stop.lng), hd = heading().toFixed(0);
      $('earth').href = `https://earth.google.com/web/@${stop.lat},${stop.lng},${Math.round(hB(g.c, g.r))}a,${stop.up ? 9000 : 2500}d,35y,${hd}h,${stop.up ? 60 : 80}t,0r`;
      $('street').hidden = !!stop.up;
      $('street').href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${stop.lat},${stop.lng}&heading=${hd}&pitch=0&fov=80`;
    }
    function aim() {
      const a = cr(stop.lat, stop.lng), b = snap(stop.subj), dx = (b.c - a.c) * DXm, dz = (b.r - a.r) * DZm;
      yaw = Math.atan2(dx, -dz);
      const top = Math.atan2(b.h - (hB(a.c, a.r) + (stop.up || 3)), Math.hypot(dx, dz));
      pitch = stop.up ? top - 0.03 : top * 0.45;
    }
    function findMoments() {
      const first = p => { for (let t = 420; t <= 1050; t += 2) if (litAt(p, t) > 0.5) return t; return null; };
      const last = p => { for (let t = 1050; t >= 420; t -= 2) if (litAt(p, t) > 0.5) return t; return null; };
      const n = stop.subj.name.replace('Mount ', '').replace(' Teton', '');
      moments = [[`First sun on ${n === 'Grand' ? 'the Grand' : n}`, first(stop.subj)], ['Sun reaches you', stop.up ? null : first(stop)], ['You lose the sun', stop.up ? null : last(stop)], [`Last sun on ${n === 'Grand' ? 'the Grand' : n}`, last(stop.subj)]];
      const box = $('moments'); box.textContent = '';
      for (const [kk, t] of moments) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'moment';
        const k1 = document.createElement('span'); k1.className = 'k'; k1.textContent = kk;
        const v1 = document.createElement('span'); v1.className = 'v'; v1.textContent = t == null ? '—' : fmt(t);
        b.append(k1, v1); if (t != null) b.addEventListener('click', () => setTime(t)); else b.disabled = true;
        box.append(b);
      }
    }
    function setTime(t) { mins = Math.max(390, Math.min(1080, t)); $('time').value = String(Math.round(mins)); relight = dirty = true; }
    function setStop(s) { stop = s; aim(); findMoments(); links(); for (const b of $('stops').children) b.setAttribute('aria-pressed', String(b.dataset.id === s.id)); relight = dirty = true; }
    function resize() { const w = frame.clientWidth, h = frame.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; dirty = true; }

    let lastT = 0;
    function tick(t) {
      if (playing) { mins += Math.min(100, t - lastT) * 0.03; if (mins >= 1050) { mins = 1050; playing = false; $('play').textContent = 'Play the day'; } $('time').value = String(Math.round(mins)); relight = dirty = true; }
      lastT = t;
      if (dirty) {
        if (relight) { light(); relight = false; }
        place();
        for (const o of [disc, halo]) { o.position.set(cam.position.x + sv.x * 190000, cam.position.y + sv.y * 190000, cam.position.z + sv.z * 190000); o.lookAt(cam.position); }
        renderer.render(scene, cam); dirty = false;
      }
      requestAnimationFrame(tick);
    }

    for (const s of STOPS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.id = s.id; b.textContent = s.name; b.addEventListener('click', () => setStop(s)); $('stops').append(b); }
    $('time').addEventListener('input', e => { playing = false; $('play').textContent = 'Play the day'; setTime(+e.target.value); });
    $('play').addEventListener('click', () => { playing = !playing; if (playing && mins >= 1040) mins = 420; $('play').textContent = playing ? 'Pause' : 'Play the day'; });
    for (const b of $('lens').children) { b.setAttribute('aria-pressed', String(+b.dataset.f === focal)); b.addEventListener('click', () => { focal = +b.dataset.f; for (const o of $('lens').children) o.setAttribute('aria-pressed', String(o === b)); dirty = true; }); }
    let drag = null;
    frame.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; frame.setPointerCapture(e.pointerId); });
    frame.addEventListener('pointermove', e => { if (!drag) return; const per = (cam.fov * Math.PI / 180) / frame.clientHeight; yaw -= (e.clientX - drag.x) * per; pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - drag.y) * per)); drag = { x: e.clientX, y: e.clientY }; dirty = true; });
    const drop = () => { if (drag) { drag = null; links(); } };
    frame.addEventListener('pointerup', drop); frame.addEventListener('pointercancel', drop);
    frame.addEventListener('keydown', e => { const st = 0.03; if (e.key === 'ArrowLeft') yaw -= st; else if (e.key === 'ArrowRight') yaw += st; else if (e.key === 'ArrowUp') pitch += st; else if (e.key === 'ArrowDown') pitch -= st; else return; e.preventDefault(); dirty = true; links(); });
    frame.tabIndex = 0;
    new ResizeObserver(resize).observe(frame);

    setStop(STOPS[0]);
    const f0 = moments[0][1]; if (f0 != null) setTime(f0 + 12);
    $('loading').hidden = true;
    resize(); requestAnimationFrame(tick);
    window.__sun3d = { setStop: id => setStop(STOPS.find(s => s.id === id)), setTime, moments: () => moments, lens: f => { focal = f; dirty = true; }, gl: () => renderer.getContext().getError() };
  }
  start();
})();
