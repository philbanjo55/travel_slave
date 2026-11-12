import * as THREE from 'three';
import { GoogleTilesRenderer } from '3d-tiles-renderer';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { sunPos } from './sun.js';

const N = 2048, NORTH = 43.95, SOUTH = 43.45, WEST = -110.92, EAST = -110.24, W = 54727, D = 55566;
const LAT0 = (NORTH + SOUTH) / 2, LNG0 = (WEST + EAST) / 2, RAD = Math.PI / 180, GEOID = -12;
const GRAND = { lat: 43.7411, lng: -110.8024, h: 4183 }, MORAN = { lat: 43.8350, lng: -110.7765, h: 3838 };
const STOPS = { sro: { lat: 43.7537, lng: -110.6241, subj: GRAND }, oxbow: { lat: 43.8662, lng: -110.5477, subj: MORAN }, barn: { lat: 43.6615, lng: -110.6642, subj: GRAND }, glacier: { lat: 43.6913, lng: -110.6727, subj: GRAND } };
let HF;
const hAt = (lat, lng) => { const c = Math.max(0, Math.min(N - 1, Math.round((lng - WEST) / (EAST - WEST) * N - .5))), r = Math.max(0, Math.min(N - 1, Math.round((NORTH - lat) / (NORTH - SOUTH) * N - .5))); return HF[r * N + c]; };
async function loadDem() {
  const buf = new Uint8Array(await (await fetch('teton-dem.png')).arrayBuffer()), dv = new DataView(buf.buffer), parts = []; let o = 8;
  while (o < buf.length) { const len = dv.getUint32(o), type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]); if (type === 'IDAT') parts.push(buf.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = new Uint8Array(await new Response(new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const q = new Uint16Array(N * N); HF = new Float32Array(N * N);
  for (let r = 0, p = 0; r < N; r++) { p++; for (let c = 0; c < N; c++, p += 2) { const i = r * N + c, res = (raw[p] << 8) | raw[p + 1]; q[i] = (res + (c ? q[i - 1] : 0) + (r ? q[i - N] : 0) - (r && c ? q[i - N - 1] : 0)) & 65535; HF[i] = 1500 + q[i] / 2; } }
}
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
// One pass over our own elevation grid: the light reaching each point (rgb, halved) and how much snow it would hold (a).
const LIGHT_FS = `
  precision highp float;
  uniform sampler2D hmap; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 amb; uniform vec2 size; uniform float texel;
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
    if (sunDir.y > 0.) { float lam = dot(n, sunDir); if (lam > 0.) {
      vec2 dir = normalize(sunDir.xz) / size; float tanA = sunDir.y / length(sunDir.xz), L = 34., dist = 0., v = 1.;
      for (int k = 0; k < 110; k++) { dist += L; vec2 p = vUv + dir * dist; float hh = h + 3. + tanA * dist;
        if (p.x < 0. || p.y < 0. || p.x > 1. || p.y > 1. || hh > 4250.) break;
        float cl = hh - H(p); if (cl <= 0.) { v = 0.; break; } v = min(v, cl / (dist * .02)); L *= 1.045; }
      d = lam * v; } }
    vec3 light = amb * (.72 + .28 * n.y) + sunCol * d;
    gl_FragColor = vec4(light * .5, 1. - smoothstep(37., 53., slope + fine * 7.));
  }`;
const TILE_VS = `varying vec2 vUv; varying vec3 vW; varying float vDist;
  void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }`;
const TILE_FS = `precision highp float;
  uniform sampler2D map; uniform sampler2D lmap; uniform vec2 size; uniform vec3 fogCol; uniform float fogD; uniform float mode;
  varying vec2 vUv; varying vec3 vW; varying float vDist;
  void main() {
    vec3 photo = texture2D(map, vUv).rgb;
    vec4 L = texture2D(lmap, vec2(.5 + vW.x / size.x, .5 + vW.z / size.y));
    float lum = dot(photo, vec3(.3, .59, .11));
    float snow = mode > 1.5 ? L.a * smoothstep(.015, .07, lum) : 0.;
    vec3 base = mix(photo, vec3(.86, .89, .94), snow);
    vec3 c = mode < .5 ? photo : base * L.rgb * 2. * (mode > 1.5 ? .95 : 1.25);
    c = pow(clamp(c, 0., 1.), vec3(1. / 2.2));
    float f = mode < .5 ? 0. : 1. - exp(-pow(fogD * vDist, 2.));
    gl_FragColor = vec4(mix(c, fogCol, f), 1.);
  }`;

async function start() {
  const q = new URLSearchParams(location.search);
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  await loadDem();
  const half = new Uint16Array(N * N * 2);
  for (let i = 0; i < N * N; i++) { const base = Math.floor(HF[i] / 64) * 64; half[i * 2] = THREE.DataUtils.toHalfFloat(base); half[i * 2 + 1] = THREE.DataUtils.toHalfFloat(HF[i] - base); }
  const hmap = new THREE.DataTexture(half, N, N, THREE.RGFormat, THREE.HalfFloatType); hmap.magFilter = hmap.minFilter = THREE.LinearFilter; hmap.needsUpdate = true;
  const size = new THREE.Vector2(W, D);
  const lightRT = new THREE.WebGLRenderTarget(N, N, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  const lightMat = new THREE.ShaderMaterial({ uniforms: { hmap: { value: hmap }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Vector3() }, amb: { value: new THREE.Vector3() }, size: { value: size }, texel: { value: 1 / N } }, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: LIGHT_FS, depthTest: false, depthWrite: false });
  const lightScene = new THREE.Scene(), lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lightMat); quad.frustumCulled = false; lightScene.add(quad);
  const shared = { lmap: { value: lightRT.texture }, size: { value: size }, fogCol: { value: new THREE.Vector3() }, fogD: { value: 0.000011 }, mode: { value: 1 } };

  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(27, 1.5, 5, 400000);
  const skyGeo = new THREE.SphereGeometry(300000, 48, 24), skyPos = skyGeo.attributes.position, skyCol = new THREE.BufferAttribute(new Float32Array(skyPos.count * 3), 3); skyGeo.setAttribute('color', skyCol);
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })); sky.frustumCulled = false; scene.add(sky);

  const tiles = new GoogleTilesRenderer('x', location.origin + '/v1/3dtiles/root.json');
  tiles.errorTarget = +(q.get('err') || 20);
  const gltf = new GLTFLoader(tiles.manager); gltf.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/')); tiles.manager.addHandler(/(gltf|glb)/, gltf);
  tiles.onLoadModel = model => model.traverse(m => { if (m.isMesh) { const map = m.material.map; m.material = new THREE.ShaderMaterial({ uniforms: { map: { value: map }, ...shared }, vertexShader: TILE_VS, fragmentShader: TILE_FS }); } });
  // local frame: origin at the middle of our elevation grid, x east, y up, z south
  const frame = new THREE.Matrix4(); tiles.ellipsoid.constructLatLonFrame(LAT0 * RAD, LNG0 * RAD, frame);
  tiles.group.matrixAutoUpdate = false; tiles.group.matrix.copy(new THREE.Matrix4().makeRotationX(-Math.PI / 2).multiply(frame.invert())); tiles.group.updateMatrixWorld(true);
  scene.add(tiles.group); tiles.setCamera(cam); tiles.setResolutionFromRenderer(cam, renderer);
  const local = (lat, lng, h) => tiles.ellipsoid.getCartographicToPosition(lat * RAD, lng * RAD, h + GEOID, new THREE.Vector3()).applyMatrix4(tiles.group.matrixWorld);

  let quiet = 0, frames = 0;
  function set({ stop, mins, focal, mode, up }) {
    const s = STOPS[stop], eye = local(s.lat, s.lng, hAt(s.lat, s.lng) + (up || 8)), top = local(s.subj.lat, s.subj.lng, s.subj.h);
    cam.position.copy(eye); cam.fov = 2 * Math.atan(12 / focal) / RAD; cam.updateProjectionMatrix();
    cam.lookAt(top.x, eye.y + (top.y - eye.y) * .45, top.z); cam.updateMatrixWorld(true); sky.position.copy(eye);
    const sp = sunPos(mins, 43.75, -110.65), a = sp.alt * RAD, z = sp.az * RAD, v = new THREE.Vector3(Math.sin(z) * Math.cos(a), Math.sin(a), -Math.cos(z) * Math.cos(a)), A = atmo(mode ? sp.alt : 30);
    lightMat.uniforms.sunDir.value.copy(v); lightMat.uniforms.sunCol.value.set(A.sun[0] * A.sunI, A.sun[1] * A.sunI, A.sun[2] * A.sunI); lightMat.uniforms.amb.value.set(A.amb[0], A.amb[1], A.amb[2]);
    renderer.setRenderTarget(lightRT); renderer.render(lightScene, lightCam); renderer.setRenderTarget(null);
    const glow = mode && sp.alt > -10 ? Math.max(0, 1 - Math.abs(sp.alt - 2) / 16) : 0;
    for (let j = 0; j < skyPos.count; j++) { const x = skyPos.getX(j) / 300000, y = skyPos.getY(j) / 300000, zz = skyPos.getZ(j) / 300000, t = Math.pow(Math.max(0, y), .45), g = Math.pow(Math.max(0, x * v.x + y * v.y + zz * v.z), 10) * glow;
      skyCol.setXYZ(j, Math.min(1, A.hor[0] + (A.zen[0] - A.hor[0]) * t + g * .9), Math.min(1, A.hor[1] + (A.zen[1] - A.hor[1]) * t + g * .55), Math.min(1, A.hor[2] + (A.zen[2] - A.hor[2]) * t + g * .25)); }
    skyCol.needsUpdate = true; shared.fogCol.value.set(A.hor[0], A.hor[1], A.hor[2]); shared.mode.value = mode;
    quiet = 0; frames = 0; window.__ready = false;
  }
  function tick() {
    cam.updateMatrixWorld(); tiles.update(); renderer.render(scene, cam); frames++;
    const st = tiles.stats; quiet = (st.downloading === 0 && st.parsing === 0 && frames > 30) ? quiet + 1 : 0;
    window.__ready = quiet > 40; window.__stats = { downloading: st.downloading, parsing: st.parsing, visible: st.visible, active: st.active, frames };
    requestAnimationFrame(tick);
  }
  window.__g = { set, credits: () => tiles.getCreditsString() };
  set({ stop: q.get('stop') || 'sro', mins: +(q.get('mins') || 600), focal: +(q.get('focal') || 50), mode: +(q.get('mode') || 1) });
  tick();
}
start().catch(e => { console.error('START FAIL', e && e.stack || e); window.__err = String(e); });
