// The "HD" 3D sun view for the app's web view: Google's Photorealistic 3D Tiles, lit by OUR light pass.
// Same window.S3D calls and replies as the offline page (app_view.js), so the app drives both the same way:
//   S3D.init(cfg)   cfg = the offline page's cfg + tiles: {
//                     base,          the tiles door, no trailing slash; the page asks <base>/v1/3dtiles/root.json
//                     draco,         folder holding draco_wasm_wrapper.js + draco_decoder.wasm (and draco_decoder.js)
//                     headers?,      extra request headers for the door
//                     root?,         root.json text the app already holds (a root request is the billable one)
//                     errorTarget?,  detail: lower = sharper and more data (default 30)
//                     lodPx?,        picture height in pixels that detail is worked out for, at most (default 1000)
//                     lift?,         eye height above Google's ground, m (default 4)
//                     geoid?,        Google's heights minus ours, m, if known (only used until Google's ground is found)
//                     wait? }        seconds to wait for the first picture before giving up (default 20)
//   S3D.chunk / done / sun / focal / view / path / recenter: as the offline page
// The sun rule is the offline page's (app_view.js): the sun's centre against the skyline, plus a horizon dip of
// 0.95 deg x sqrt(km above the area's low ground) for high points, in the point checks and in the light pass, so
// first / last light and the lit / shade line are the same in both modes. Google's mesh is the surface here, so the
// light pass and the point checks use the wide grid alone: a `near` or `detail` grid in init and their chunks ("near", "detail", "mask") are ignored.
// Replies: boot, ready, state, moments, look, error (as the offline page; after an error the app goes back to the
// offline page), plus credits {text, band} and hd {shown, loading}.
// Google's Map Tiles policy (read 12 Nov 2026) is met on the page itself, along the bottom of the picture (#attr):
// the unmodified outlined Google Maps logo, 18 px high with its clear space (the words "Google Maps" when the view is
// tiny), the tiles' data credits in one line beside it (most frequent first; they wrap when they don't fit), and above
// them a line saying which part is Google's and which is ours. The app keeps its own labels off that band
// (`band` = its height in px). Tiles are held in memory only; the web view's own HTTP cache follows the
// Cache-Control / ETag headers the door passes through from Google. Nothing is written to storage.
// It still needs our elevation file: the light map, the first / last light checks and the camera all come from it.
// Built into src/components/sun/sun3dGoogleHtml.ts by tools/sun3d/build_app_google_html.js. Do not edit the generated file.
import * as THREE from 'three';
import { GoogleTilesRenderer } from '3d-tiles-renderer';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const post = m => { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) { /* not in the app */ } };
const say = t => { const m = document.getElementById('msg'); m.textContent = t || ''; m.style.display = t ? 'flex' : 'none'; };
let dead = false;
const fail = (t, detail) => { if (dead) return; dead = true; say(t); const a = document.getElementById('attr'); if (a) a.style.display = 'none'; post({ type: 'error', msg: t, detail: detail ? String(detail).slice(0, 300) : undefined }); stop(); };
window.onerror = msg => { fail("The HD picture couldn't be drawn.", msg); };
window.addEventListener('unhandledrejection', e => { fail("The HD picture couldn't be drawn.", e && e.reason && (e.reason.message || e.reason)); });

const RAD = Math.PI / 180, A_WGS = 6378137, E2 = 0.00669437999014;
let cfg = null, parts = [], HF = null, N = 0, W = 0, D = 0, maxH = 4250, baseH = 0, DXm = 1, DZm = 1;
let R = null;   // everything three.js, once built
let eye = null, target = null, yaw = 0, pitch = 0, focal = 50, lens = { f: 135, fw: 120, fh: 96, box: true }, inline = false, sun = { az: 180, alt: 20 }, dirty = true, relight = true, hiTimer = null;
let groundY = null, frames = 0, calm = 0, t0 = 0, shown = false, lastCredits = null, lastHd = '';

// ---- Google's attribution band, on the picture ----
const el = id => document.getElementById(id);
function band(on) {
  const a = el('attr'); if (!a) return;
  a.style.display = on ? 'block' : 'none';
  a.classList.toggle('small', window.innerWidth < 230 || window.innerHeight < 120);
  el('ours').textContent = 'Picture: Google Maps. ' + (cfg && cfg.ground === 'green' ? 'Light and shadows are calculated.' : 'Light, shadows and snow are calculated.');
}
// the credits stay on one line beside the logo when they fit, and wrap (shown in full) when they don't
function fit() { const c = el('cred'); if (!c) return; c.classList.remove('wrap'); if (c.scrollWidth > c.clientWidth + 1) c.classList.add('wrap'); }
function credits(text) {
  const c = el('cred'); if (c) { c.textContent = text; fit(); }
  post({ type: 'credits', text, band: el('attr') ? el('attr').offsetHeight : 0 });
}

// ---- our elevation grid: the same point checks as the offline page ----
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
const snap = (p, rad) => { const q = cr(p); let best = null; for (let r = Math.round(q.r) - rad; r <= Math.round(q.r) + rad; r++) for (let c = Math.round(q.c) - rad; c <= Math.round(q.c) + rad; c++) { if (r < 0 || c < 0 || r >= N || c >= N) continue; const h = HF[r * N + c]; if (!best || h > best.h) best = { c, r, h }; } return best; };
const sunVec = (az, alt) => { const a = alt * RAD, z = az * RAD; return { x: Math.sin(z) * Math.cos(a), y: Math.sin(a), z: -Math.cos(z) * Math.cos(a), tan: Math.tan(a), hx: Math.sin(z), hz: -Math.cos(z) }; };
const far = () => { const a = cr(eye), b = cr(target); return Math.hypot((b.c - a.c) * DXm, (b.r - a.r) * DZm); };
const subjPoint = () => { const q = far() > 3000 ? snap(target, 4) : null; if (q) return q; const c = cr(target); return { c: c.c, r: c.r, h: hB(c.c, c.r) + 6 }; };
const herePoint = () => { const c = cr(eye); return { c: c.c, r: c.r, h: hB(c.c, c.r) }; };
// The sun counts when its centre clears the terrain. A high point sees it a little below the flat horizon (the dip).
const dipOf = h => 0.95 * Math.sqrt(Math.max(0, h - baseH) / 1000);
const lit = (p, az, alt) => { if (alt <= -dipOf(p.h)) return false; const v = sunVec(az, alt); return vis(p.c, p.r, p.h, v.hx, v.hz, v.tan) > 0; };
const inside = p => p && p.lat <= cfg.north && p.lat >= cfg.south && p.lng >= cfg.west && p.lng <= cfg.east;

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

// One pass over our own elevation grid: the light reaching each point (rgb, halved) and how well it holds snow (a).
const LIGHT_FS = `
  precision highp float;
  uniform sampler2D hmap; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 amb; uniform vec2 size; uniform float texel; uniform float maxH; uniform float baseH;
  varying vec2 vUv;
  float H(vec2 uv) { vec2 t = texture2D(hmap, uv).rg; return t.r + t.g; }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    float h = H(vUv);
    float hx = (H(vUv + vec2(texel, 0.)) - H(vUv - vec2(texel, 0.))) / (2. * texel * size.x);
    float hz = (H(vUv + vec2(0., texel)) - H(vUv - vec2(0., texel))) / (2. * texel * size.y);
    vec3 n = normalize(vec3(-hx, 1., -hz));
    float slope = degrees(acos(n.y)), fine = hash(floor(vUv / texel));
    float d = 0.;
    if (sunDir.y > -sin(radians(.95) * sqrt(max(0., h - baseH) / 1000.))) { float lam = dot(n, sunDir); if (lam > 0.) {   // a high point still sees a sun just under the flat horizon
      vec2 dir = normalize(sunDir.xz) / size; float tanA = sunDir.y / length(sunDir.xz), L = 34., dist = 0., v = 1.;
      for (int k = 0; k < 110; k++) { dist += L; vec2 p = vUv + dir * dist; float hh = h + 3. + tanA * dist;
        if (p.x < 0. || p.y < 0. || p.x > 1. || p.y > 1. || hh > maxH) break;
        float cl = hh - H(p); if (cl <= 0.) { v = 0.; break; } v = min(v, cl / (dist * .02)); L *= 1.045; }
      d = lam * v; } }
    vec3 light = amb * (.72 + .28 * n.y) + sunCol * d;
    gl_FragColor = vec4(light * .5, 1. - smoothstep(37., 53., slope + fine * 7.));
  }`;
// A Google tile: where it sits on our grid (the scene is centred where you stand: x east, y up, z south), then photo x light.
const TILE_VS = `
  uniform vec4 geo;    // meridian radius, tan(lat0) / (2 x east-west radius), east-west radius, lat0
  uniform vec4 span;   // lng0 - west, north - lat0, 1 / (east - west), 1 / (north - south): radians
  varying vec2 vUv; varying vec2 vL; varying float vDist;
  void main() {
    vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vec4 mv = viewMatrix * w; vDist = length(mv.xyz);
    float dphi = (-w.z - w.x * w.x * geo.y) / (geo.x + w.y);
    float lam = w.x / ((geo.z + w.y) * cos(geo.w + dphi));
    vL = vec2((span.x + lam) * span.z, (span.y - dphi) * span.w);
    gl_Position = projectionMatrix * mv;
  }`;
const TILE_FS = `
  precision highp float;
  uniform sampler2D map; uniform sampler2D lmap; uniform vec4 flatL; uniform vec3 fogCol; uniform float fogD; uniform float mode;
  varying vec2 vUv; varying vec2 vL; varying float vDist;
  void main() {
    vec3 photo = texture2D(map, vUv).rgb;
    float edge = min(min(vL.x, 1. - vL.x), min(vL.y, 1. - vL.y));
    vec4 L = mix(flatL, texture2D(lmap, vL), smoothstep(0., .012, edge));   // beyond our grid: flat-ground light
    float lum = dot(photo, vec3(.3, .59, .11));
    float snow = mode > 1.5 ? L.a * smoothstep(.015, .07, lum) : 0.;
    vec3 base = mix(photo, vec3(.86, .89, .94), snow);
    vec3 c = base * L.rgb * 2. * (mode > 1.5 ? .95 : 1.25);
    c = pow(clamp(c, 0., 1.), vec3(1. / 2.2));
    float f = 1. - exp(-pow(fogD * vDist, 2.));
    gl_FragColor = vec4(mix(c, fogCol, f), 1.);
  }`;

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
  { const lows = []; for (let i = 0; i < HF.length; i += 37) lows.push(HF[i]); lows.sort((a, b) => a - b); baseH = lows[Math.floor(lows.length * 0.1)] || 0; }   // the area's low ground: valley floor, or the sea
}

function build() {
  const T = cfg.tiles, canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2) throw new Error('no WebGL2');
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // colours are written as they should look, as on the offline page
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  canvas.addEventListener('webglcontextlost', () => fail('The HD picture ran out of memory on this phone.'));
  const half = new Uint16Array(N * N * 2);
  for (let i = 0; i < N * N; i++) { const base = Math.floor(HF[i] / 64) * 64; half[i * 2] = THREE.DataUtils.toHalfFloat(base); half[i * 2 + 1] = THREE.DataUtils.toHalfFloat(HF[i] - base); }
  const hmap = new THREE.DataTexture(half, N, N, THREE.RGFormat, THREE.HalfFloatType);
  hmap.magFilter = hmap.minFilter = THREE.LinearFilter; hmap.wrapS = hmap.wrapT = THREE.ClampToEdgeWrapping; hmap.needsUpdate = true;
  const size = new THREE.Vector2(W, D);
  const rt = n => new THREE.WebGLRenderTarget(n, n, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  const lo = rt(Math.min(1024, N)), hi = rt(N);
  const lightMat = new THREE.ShaderMaterial({ uniforms: { hmap: { value: hmap }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Vector3() }, amb: { value: new THREE.Vector3() }, size: { value: size }, texel: { value: 1 / N }, maxH: { value: maxH }, baseH: { value: baseH } }, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: LIGHT_FS, depthTest: false, depthWrite: false });
  const lightScene = new THREE.Scene(), lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lightMat); quad.frustumCulled = false; lightScene.add(quad);
  // one set of uniforms for every tile
  const shared = { lmap: { value: lo.texture }, flatL: { value: new THREE.Vector4(.5, .5, .5, 1) }, fogCol: { value: new THREE.Vector3() }, fogD: { value: 0.000011 }, mode: { value: cfg.ground === 'green' ? 1 : 2 }, geo: { value: new THREE.Vector4() }, span: { value: new THREE.Vector4() } };
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;

  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(27, 1.5, 4, 260000); cam.rotation.order = 'YXZ';
  const skyGeo = new THREE.SphereGeometry(200000, 48, 24), skyPos = skyGeo.attributes.position, skyCol = new THREE.BufferAttribute(new Float32Array(skyPos.count * 3), 3); skyGeo.setAttribute('color', skyCol);
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })); sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2100, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
  const halo = new THREE.Mesh(new THREE.CircleGeometry(9000, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.22, depthWrite: false }));
  scene.add(halo); scene.add(disc);

  // Google's tiles, asked for through the door in cfg.tiles.base: the page never holds a Google key.
  const base = String(T.base).replace(/\/+$/, ''), MARK = '/v1/3dtiles/', rootUrl = base + MARK + 'root.json';
  let session = null;
  const door = uri => {   // every tile address goes to the door, whatever host or path the tile set names
    let u; try { u = new URL(uri, rootUrl); } catch (e) { return uri; }
    const i = u.pathname.indexOf(MARK); if (!/^http/.test(u.protocol) || i < 0) return uri;
    u.searchParams.delete('key');
    const all = u.searchParams.getAll('session'); u.searchParams.delete('session');
    const s = all.length ? all[all.length - 1] : session; if (s) u.searchParams.set('session', s);
    const q = u.searchParams.toString();
    return base + u.pathname.slice(i) + (q ? '?' + q : '');
  };
  if (T.root) {   // the app already holds the root tile set: don't ask (and pay) for another
    const real = window.fetch.bind(window), text = typeof T.root === 'string' ? T.root : JSON.stringify(T.root);
    window.fetch = (u, o) => String(u).split('?')[0] === rootUrl ? Promise.resolve(new Response(text, { status: 200, headers: { 'content-type': 'application/json' } })) : real(u, o);
  }
  const tiles = new GoogleTilesRenderer('x', rootUrl);
  tiles.preprocessURL = door;
  tiles.addEventListener('load-tile-set', () => {
    if (!session) tiles.traverse(t => { if (t.content && t.content.uri) { try { session = new URL(t.content.uri).searchParams.get('session'); } catch (e) { /* keep looking */ } return !!session; } return false; });
    tiles.preprocessURL = door;   // the library swaps in its own (it adds a key) when the root arrives: put ours back
  });
  if (T.headers) tiles.fetchOptions.headers = T.headers;
  tiles.errorTarget = T.errorTarget || 30;
  tiles.lruCache.minSize = 900; tiles.lruCache.maxSize = 1400;
  tiles.downloadQueue.maxJobs = 12; tiles.parseQueue.maxJobs = 4;
  const draco = new DRACOLoader().setDecoderPath(String(T.draco).replace(/\/*$/, '/'));
  const gltf = new GLTFLoader(tiles.manager); gltf.setDRACOLoader(draco); tiles.manager.addHandler(/(gltf|glb)/, gltf);
  tiles.onLoadModel = model => model.traverse(m => {
    if (!m.isMesh) return;
    const old = m.material, map = (old && old.map) || white;
    m.material = new THREE.ShaderMaterial({ uniforms: { map: { value: map }, ...shared }, vertexShader: TILE_VS, fragmentShader: TILE_FS });
    m.material.userData.map = map; if (old && old.dispose) old.dispose();
  });
  tiles.onDisposeModel = model => model.traverse(m => { if (m.isMesh && m.material) { const map = m.material.userData.map; if (map && map !== white) map.dispose(); m.material.dispose(); } });
  tiles.group.matrixAutoUpdate = false; scene.add(tiles.group);
  // a second, small camera looking straight down at where you stand, so Google's own ground there is loaded
  // and the eye can be put on it (our grid and Google's surface differ by some metres)
  const downCam = new THREE.PerspectiveCamera(30, 1, 10, 6000);
  tiles.setCamera(cam); tiles.setCamera(downCam); tiles.setResolution(downCam, 384, 384);
  R = { renderer, canvas, lo, hi, lightMat, lightScene, lightCam, shared, scene, cam, downCam, sky, skyPos, skyCol, disc, halo, tiles, draco, rootUrl, ray: new THREE.Raycaster(), sv: sunVec(180, 20) };
}

// The scene is centred on the ground where you stand (x east, y up, z south), so "up" on screen is the real up there.
function frame() {
  const t = R.tiles, f = new THREE.Matrix4(), lat = eye.lat * RAD, s = Math.sin(lat), k = 1 - E2 * s * s;
  t.ellipsoid.constructLatLonFrame(lat, eye.lng * RAD, f);
  t.group.matrix.copy(new THREE.Matrix4().makeRotationX(-Math.PI / 2).multiply(f.invert())); t.group.updateMatrixWorld(true);
  const Nr = A_WGS / Math.sqrt(k), Mr = A_WGS * (1 - E2) / Math.pow(k, 1.5);
  R.shared.geo.value.set(Mr, Math.tan(lat) / (2 * Nr), Nr, lat);
  R.shared.span.value.set((eye.lng - cfg.west) * RAD, (cfg.north - eye.lat) * RAD, 1 / ((cfg.east - cfg.west) * RAD), 1 / ((cfg.north - cfg.south) * RAD));
  groundY = null; calm = 0;
}
const local = (p, h) => R.tiles.ellipsoid.getCartographicToPosition(p.lat * RAD, p.lng * RAD, h, new THREE.Vector3()).applyMatrix4(R.tiles.group.matrixWorld);
const guessY = () => { const q = cr(eye); return hB(q.c, q.r) + (cfg.tiles.geoid || 0); };   // our grid's height, before Google's ground is known

function lightPass(to) {
  R.renderer.setRenderTarget(to); R.renderer.render(R.lightScene, R.lightCam); R.renderer.setRenderTarget(null);
  R.shared.lmap.value = to.texture;
}
function light() {
  const v = sunVec(sun.az, sun.alt), A = atmo(sun.alt), sc = [A.sun[0] * A.sunI, A.sun[1] * A.sunI, A.sun[2] * A.sunI], up = Math.max(0, v.y); R.sv = v;
  R.lightMat.uniforms.sunDir.value.set(v.x, v.y, v.z);
  R.lightMat.uniforms.sunCol.value.set(sc[0], sc[1], sc[2]);
  R.lightMat.uniforms.amb.value.set(A.amb[0], A.amb[1], A.amb[2]);
  R.shared.flatL.value.set((A.amb[0] + sc[0] * up) * .5, (A.amb[1] + sc[1] * up) * .5, (A.amb[2] + sc[2] * up) * .5, 1);
  lightPass(R.lo);   // quick pass while the time is moving, the full one once it rests
  clearTimeout(hiTimer); hiTimer = setTimeout(() => { if (R && !dead) { lightPass(R.hi); dirty = true; } }, 260);
  const glow = sun.alt > -10 ? Math.max(0, 1 - Math.abs(sun.alt - 2) / 16) : 0, sp = R.skyPos;
  for (let j = 0; j < sp.count; j++) {
    const x = sp.getX(j) / 200000, y = sp.getY(j) / 200000, z = sp.getZ(j) / 200000;
    const t = Math.pow(Math.max(0, y), 0.45), g = Math.pow(Math.max(0, x * v.x + y * v.y + z * v.z), 10) * glow;
    R.skyCol.setXYZ(j, Math.min(1, A.hor[0] + (A.zen[0] - A.hor[0]) * t + g * 0.9), Math.min(1, A.hor[1] + (A.zen[1] - A.hor[1]) * t + g * 0.55), Math.min(1, A.hor[2] + (A.zen[2] - A.hor[2]) * t + g * 0.25));
  }
  R.skyCol.needsUpdate = true;
  R.shared.fogCol.value.set(A.hor[0], A.hor[1], A.hor[2]);
  R.disc.visible = R.halo.visible = sun.alt > -1;
  R.disc.material.color.setRGB(1, Math.min(1, .75 + A.sun[1] * .25), Math.min(1, .5 + A.sun[2] * .5));
  R.halo.material.color.setRGB(A.sun[0], A.sun[1], A.sun[2]);
  post({ type: 'state', subjectLit: lit(subjPoint(), sun.az, sun.alt), hereLit: lit(herePoint(), sun.az, sun.alt), up: sun.alt > 0 });
}
function aim() {
  const a = cr(eye), t = local(target, 0), dist = Math.hypot(t.x, t.z);
  yaw = dist > 5 ? Math.atan2(t.x, -t.z) : 0;
  const top = dist > 3000 ? Math.atan2(snap(target, 4).h - (hB(a.c, a.r) + 3), dist) : 0.04;
  pitch = Math.max(0.01, top * 0.45);
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
  const cam = R.cam, y = (groundY == null ? guessY() + 40 : groundY) + (cfg.tiles.lift || 4);   // held high until Google's ground is found
  cam.position.set(0, y, 0); cam.rotation.set(pitch, -yaw, 0);
  cam.fov = lensFov() / RAD; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); R.sky.position.copy(cam.position);
  const d = R.downCam; d.position.set(0, guessY() + 500, 0); d.rotation.set(-Math.PI / 2, 0, 0); d.updateMatrixWorld(true);
}
// Google's ground under the eye, from the tiles loaded so far
function findGround() {
  const top = guessY() + 3000; R.ray.set(new THREE.Vector3(0, top, 0), new THREE.Vector3(0, -1, 0)); R.ray.firstHitOnly = true;
  const hit = R.ray.intersectObject(R.tiles.group, true)[0];
  if (!hit) return;
  const y = top - hit.distance;
  if (groundY == null || Math.abs(y - groundY) > 0.4) { groundY = y; dirty = true; }
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight; if (!R || !w || !h) return;
  R.renderer.setSize(w, h, false); R.cam.aspect = w / h;
  // detail follows the picture's height in pixels, up to a cap: a tall full-screen view would otherwise pull over twice the data
  const px = h * R.renderer.getPixelRatio(), k = Math.min(1, (cfg.tiles.lodPx || 1000) / px);
  R.tiles.setResolution(R.cam, w * R.renderer.getPixelRatio() * k, px * k); dirty = true;
  if (shown) { band(true); fit(); }
}
function stop() {
  clearTimeout(hiTimer);
  if (R) { try { R.tiles.dispose(); R.draco.dispose(); } catch (e) { /* already gone */ } }
}
function tick() {
  if (dead || !R) return;
  const t = R.tiles, st = t.stats; frames++;
  const rootState = t.tileSets[t.rootURL];
  if (rootState instanceof Error) return fail("Google's 3D picture couldn't load.", rootState.message);
  const busy = st.downloading + st.parsing > 0;
  calm = busy ? 0 : calm + 1;
  if (dirty || busy || calm < 40) {
    if (relight) { light(); relight = false; }
    place();
    t.update();
    if (frames % 12 === 0 || calm === 20) findGround();
    const cam = R.cam, v = R.sv;
    for (const o of [R.disc, R.halo]) { o.position.set(cam.position.x + v.x * 190000, cam.position.y + v.y * 190000, cam.position.z + v.z * 190000); o.lookAt(cam.position); }
    R.renderer.render(R.scene, cam); dirty = false;
    if (!shown && st.visible > 0 && groundY != null) { shown = true; say(''); band(true); lastCredits = null; }
  }
  if (!shown && Date.now() - t0 > (cfg.tiles.wait || 20) * 1000) return fail("Google's 3D picture didn't arrive. It needs a good signal.", 'nothing to show after ' + Math.round((Date.now() - t0) / 1000) + ' s, ' + st.failed + ' failed');
  if (st.failed > 40) return fail("Google's 3D picture stopped loading.", st.failed + ' tiles failed');
  if (frames % 30 === 0) {
    const c = t.getCreditsString(); if (shown && c !== lastCredits) { lastCredits = c; credits(c); }
    const hd = JSON.stringify({ shown, loading: busy || calm < 40 }); if (hd !== lastHd) { lastHd = hd; post({ type: 'hd', shown, loading: busy || calm < 40, tiles: st.visible, failed: st.failed }); }
  }
  requestAnimationFrame(tick);
}
function heading() { post({ type: 'look', deg: Math.round(((yaw / RAD) % 360 + 360) % 360) }); }

let drag = null;
function wire() {
  const c = R.canvas;
  c.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; try { c.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } });
  c.addEventListener('pointermove', e => { if (!drag) return; const per = (R.cam.fov * RAD) / window.innerHeight; yaw -= (e.clientX - drag.x) * per; if (!inline) pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - drag.y) * per)); drag = { x: e.clientX, y: e.clientY }; dirty = true; });
  const drop = () => { if (drag) { drag = null; heading(); } };
  c.addEventListener('pointerup', drop); c.addEventListener('pointercancel', drop);
  window.addEventListener('resize', resize);
}

window.S3D = {
  init(c) { cfg = c; cfg.tiles = cfg.tiles || {}; parts = []; N = c.n; W = c.W; D = c.D; DXm = W / N; DZm = D / N; eye = c.eye; target = c.target; focal = c.focal || 50; if (c.lens) lens = Object.assign({}, lens, c.lens); inline = !!c.inline; { const cv = document.getElementById('view'); if (cv) cv.style.touchAction = inline ? 'pan-y' : 'none'; } },
  chunk(s, which) { if (!which) parts.push(s); },   // the fine grid and the detail grid are not used here
  async done() {
    try {
      if (typeof DecompressionStream === 'undefined') return fail("This phone's web view is too old for the 3D view.");
      if (!inside(eye)) return fail('This spot is outside the 3D terrain for the area.');
      if (!cfg.tiles.base || !cfg.tiles.draco) return fail('The HD picture is not set up.');
      await decode(); build(); frame(); aim(); wire(); resize();
      say("Getting Google's 3D picture…"); relight = dirty = true; t0 = Date.now(); requestAnimationFrame(tick);
      post({ type: 'ready', n: N, gl: 'webgl2', hd: true }); heading();
    } catch (e) { fail("The HD picture couldn't start on this phone.", e && e.message || e); }
  },
  sun(az, alt) { sun = { az, alt }; relight = dirty = true; },
  focal(f) { lens = Object.assign({}, lens, { f }); dirty = true; },
    // lens({ f, fw, fh, box }): focal length, film width / height in mm as the camera is turned, frame box on / off
    lens(o) { lens = Object.assign({}, lens, o || {}); dirty = true; },
    // inline(true): the small view inside a scrolling page. A sideways drag looks around; up-down drags are left to the
    // page (touch-action pan-y), so the two no longer fight. Full screen: free look both ways.
    inline(v) { inline = !!v; const c = document.getElementById('view'); if (c) c.style.touchAction = inline ? 'pan-y' : 'none'; },
  view(eLat, eLng, tLat, tLng) {
    const moved = !eye || eye.lat !== eLat || eye.lng !== eLng;
    eye = { lat: eLat, lng: eLng }; target = { lat: tLat, lng: tLng }; if (!R || dead) return;
    if (!inside(eye)) return fail('This spot is outside the 3D terrain for the area.');
    if (moved) { frame(); if (shown) { shown = false; t0 = Date.now(); band(false); say("Getting Google's 3D picture…"); } }
    aim(); relight = dirty = true; heading();
  },
  recenter() { if (R && !dead) { aim(); dirty = true; heading(); } },
  path(arr) {
    if (!R) return;
    const s = subjPoint(), h = herePoint(); let fs = null, ls = null, fh = null, lh = null;
    for (const [m, az, alt] of arr) { if (lit(s, az, alt)) { if (fs == null) fs = m; ls = m; } if (lit(h, az, alt)) { if (fh == null) fh = m; lh = m; } }
    post({ type: 'moments', firstSubject: fs, lastSubject: ls, firstHere: fh, lastHere: lh });
  },
};
post({ type: 'boot' });
