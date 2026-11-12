// Proof renderer, round 2 (standalone, three.js r128). view2.html?v=<name>[&f=<focal mm>]   data from prep2.py in data2/<name>/.
// Four nested grids: the detail box (1-2 m ground, its own photo), the 4 m fine box cropped (mid) and whole at 8 m (nf),
// both under the fine box's photo, and the wide grid in plain colours tinted to the photo. Buildings come from the
// building file: each outline extruded, with a pitched roof along its long axis. Faces steeper than about 55 degrees
// are drawn as rock, never as photo. A stream (mask 4) on steep ground is a white fall.
(async () => {
  const q = new URLSearchParams(location.search), name = q.get('v'), W = +(q.get('w') || 1500), H = +(q.get('h') || 1200);
  const meta = await (await fetch(`data2/${name}/meta.json`)).json();
  const bin = async (f, T) => new T(await (await fetch(`data2/${name}/${f}`)).arrayBuffer());
  const [slat, slng] = meta.stand, kx = meta.kx, kz = meta.kz, X = lng => (lng - slng) * kx, Z = lat => -(lat - slat) * kz;
  const focal = +(q.get('f') || meta.lens), RE = 6371000 * 7 / 6;
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(2 * Math.atan(48 / focal) * 180 / Math.PI, W / H, 0.5, 90000);   // 4x5 film, landscape: 120 x 96 mm
  cam.position.set(0, meta.eye + 1.6, 0); cam.lookAt(X(meta.subject[1]), meta.subject_h + meta.aim_up, Z(meta.subject[0]));
  const sa = meta.sun.alt * Math.PI / 180, sz = meta.sun.az * Math.PI / 180;
  const sunDir = new THREE.Vector3(Math.sin(sz) * Math.cos(sa), Math.sin(sa), -Math.cos(sz) * Math.cos(sa));
  const k = Math.min(1, Math.max(0, meta.sun.alt / 25)), ks = k * k * (3 - 2 * k);
  const sunCol = new THREE.Vector3(1.0, 0.62 + 0.33 * ks, 0.38 + 0.50 * ks).multiplyScalar(0.92);
  const amb = new THREE.Vector3(0.30, 0.34, 0.40), fogCol = new THREE.Vector3(0.74, 0.80, 0.86);
  const V3 = a => new THREE.Vector3(a[0], a[1], a[2]);
  const U = extra => Object.assign({ sunDir: { value: sunDir }, sunCol: { value: sunCol }, amb: { value: amb }, fogCol: { value: fogCol }, fogD: { value: 55000 }, camPos: { value: cam.position } }, extra);
  const dataTex = (a, n, m, filter) => { const t = new THREE.DataTexture(a, m, n, THREE.LuminanceFormat, THREE.UnsignedByteType); t.minFilter = t.magFilter = filter; t.flipY = false; t.needsUpdate = true; return t; };
  const loadTex = f => new Promise(r => new THREE.TextureLoader().load(`data2/${name}/${f}`, t => { t.flipY = false; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.needsUpdate = true; r(t); }));
  function grid(h, n, m, box) {
    const [north, south, west, east] = box, pos = new Float32Array(n * m * 3), uv = new Float32Array(n * m * 2), hh = new Float32Array(n * m);
    for (let i = 0, p = 0; i < n; i++) { const z = Z(north - (i + .5) * (north - south) / n);
      for (let j = 0; j < m; j++, p++) { const x = X(west + (j + .5) * (east - west) / m), y = h[p];
        pos[p * 3] = x; pos[p * 3 + 1] = y - (x * x + z * z) / (2 * RE); pos[p * 3 + 2] = z; uv[p * 2] = (j + .5) / m; uv[p * 2 + 1] = (i + .5) / n; hh[p] = y; } }
    const idx = new Uint32Array((n - 1) * (m - 1) * 6);
    for (let i = 0, t = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) { const a = i * m + j, b = a + 1, c = a + m, d = c + 1; idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('hgt', new THREE.BufferAttribute(hh, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals(); return g;
  }
  const VS = `attribute float hgt; varying vec2 vUv; varying vec3 vPos; varying vec3 vN; varying float vH;
    void main() { vUv = uv; vPos = position; vN = normal; vH = hgt; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
  const COMMON = `precision highp float;
    uniform vec3 sunDir, sunCol, amb, fogCol, camPos; uniform float fogD;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1.)), f.x), f.y); }
    vec3 sky(vec3 d) { float t = clamp(d.y, 0., 1.); vec3 c = mix(vec3(.76, .82, .88), vec3(.27, .46, .74), pow(t, .55));
      float s = max(dot(d, sunDir), 0.); c += sunCol * (pow(s, 600.) * 3. + pow(s, 24.) * .16); return c; }
    vec3 waterCol(vec3 pos, float vis) { vec3 V = normalize(camPos - pos); float fr = pow(1. - max(V.y, 0.), 5.);
      vec3 R = reflect(-V, normalize(vec3(.02 * (vnoise(pos.xz * .7) - .5), 1., .02 * (vnoise(pos.zx * .7 + 7.) - .5))));
      vec3 c = mix(vec3(.035, .10, .15), sky(vec3(R.x, abs(R.y), R.z)), clamp(.06 + .94 * fr, 0., 1.));
      return c + sunCol * pow(max(dot(R, sunDir), 0.), 180.) * vis * 2.5; }
    vec3 haze(vec3 c, vec3 pos) { float d = length(camPos - pos); return mix(c, fogCol, 1. - exp(-d / fogD)); }`;
  const FS = `${COMMON}
    uniform sampler2D lmap, photo, near, kmap; uniform float mode, side, cutOn, cells; uniform vec4 cut, nrect; uniform vec3 tint, rock;
    varying vec2 vUv; varying vec3 vPos; varying vec3 vN; varying float vH;
    // basalt in beds: flat-lying bands by height, darker joints, a little of the grass tone on the ledges
    vec3 cliff(vec3 pos, float slope) { float bed = vnoise(vec2(pos.y * .30, (pos.x + pos.z) * .012)), fine = vnoise(vec2(pos.y * 1.7, (pos.x - pos.z) * .05)), joint = vnoise(vec2((pos.x - pos.z) * .55, pos.y * .05));
      vec3 c = rock * (.72 + .5 * bed + .22 * fine - .18 * step(.72, joint));
      float ledge = smoothstep(.62, .8, vnoise(vec2(pos.y * .22 + 3., (pos.x + pos.z) * .02))) * (1. - smoothstep(60., 80., slope));
      return mix(c, tint * .8, ledge * .5); }
    vec3 plain(vec3 pos, float h, float slope) { float pch = vnoise(pos.xz / 300.) * .6 + vnoise(pos.xz / 90.) * .4;
      vec3 g = mix(tint, tint * vec3(1.05, .95, .86), smoothstep(120., 620., h + pch * 160.)) * (.9 + .2 * pch);
      return mix(g, cliff(pos, slope), smoothstep(36., 52., slope)); }
    void main() {
      if (cutOn > .5 && vPos.x > cut.x && vPos.x < cut.y && vPos.z > cut.z && vPos.z < cut.w) discard;
      vec3 n = normalize(vN); float slope = degrees(acos(clamp(n.y, -1., 1.)));
      float vis = texture2D(lmap, vUv).r, lam = max(dot(n, sunDir), 0.), dcam = length(camPos - vPos);
      vec3 alb; bool sea = vH < .6; float kind = 0., fall = 0.;
      vec2 nuv = (vPos.xz - nrect.xy) / nrect.zw;                                   // where this point is in the fine box's photo
      if (mode < .5) alb = plain(vPos, vH, slope);                                  // the wide grid: plain, in the photo's tone
      else {
        vec3 ph = texture2D(near, nuv).rgb;
        if (mode > 1.5) { float e = min(min(vUv.x, 1. - vUv.x), min(vUv.y, 1. - vUv.y)) * side;
          ph = mix(ph, texture2D(photo, vUv).rgb, smoothstep(4., 44., e));           // the detail box's sharper photo, eased in at its edge
          kind = floor(texture2D(kmap, vUv).r * 255. + .5);
          vec2 upv = length(n.xz) > .01 ? -normalize(n.xz) / cells : vec2(0.);
          float ku = floor(texture2D(kmap, vUv + upv * 1.2).r * 255. + .5), ku2 = floor(texture2D(kmap, vUv + upv * 2.4).r * 255. + .5);
          if (slope > 40. && (kind == 4. || ku == 4. || ku2 == 4.)) fall = 1.;
          // close to the eye a 0.5 m photo is a blur: grass and stones of our own on top of it
          float w = 1. - smoothstep(7., 30., dcam);
          float tuft = vnoise(vPos.xz * 9.) * .5 + vnoise(vPos.xz * 31.) * .3 + vnoise(vPos.xz * 2.3) * .2;
          ph *= 1. + w * (.75 * (tuft - .5));
          float blade = vnoise(vec2(vPos.x * 70. + vPos.z * 11., vPos.z * 9.)); ph *= 1. + w * w * .30 * (blade - .5);
          float stone = step(.955, hash(floor(vPos.xz * 3.))) * step(.5, vnoise(vPos.xz * .35)); ph = mix(ph, vec3(.52, .51, .49) * (.8 + .4 * hash(floor(vPos.xz * 3.) + 9.)), stone * w * .7);
        }
        alb = mix(ph, cliff(vPos, slope), smoothstep(50., 62., slope));              // a photo from above shows nothing of an upright face
      }
      vec3 col = alb * (amb + sunCol * lam * vis);
      if (fall > .5) col = mix(vec3(.84, .88, .92), vec3(.98), vnoise(vec2(vPos.x * 3. + vPos.z * 3., vPos.y * .35))) * (amb * 1.25 + sunCol * (.3 + .6 * lam) * vis);
      else if (mode > 1.5 && kind == 3. && slope < 25.) col = (sea || vH < .6) ? waterCol(vPos, vis) : mix(col, waterCol(vPos, vis), .92);
      else if (mode > 1.5 && kind == 4. && slope < 40.) col = mix(col, waterCol(vPos, vis), .30);
      else if (sea && slope < 25.) col = waterCol(vPos, vis);
      gl_FragColor = vec4(haze(col, vPos), 1.);
    }`;
  const D = meta.detail, M = meta.mid, NF = meta.nf, Wd = meta.wide;
  const rect = box => new THREE.Vector4(X(box[2]), X(box[3]), Z(box[0]), Z(box[1]));
  const shrink = (v, d) => new THREE.Vector4(v.x + d, v.y - d, v.z + d, v.w - d);
  const nb = rect(NF.box), nrect = new THREE.Vector4(nb.x, nb.z, nb.y - nb.x, nb.w - nb.z);
  const [photo, near] = await Promise.all([loadTex('photo.jpg'), loadTex('near.jpg')]);
  const terrain = extra => new THREE.ShaderMaterial({ uniforms: U(Object.assign({ lmap: { value: null }, photo: { value: photo }, near: { value: near }, kmap: { value: null }, mode: { value: 0 }, side: { value: 1 }, cells: { value: D.n },
    cutOn: { value: 0 }, cut: { value: new THREE.Vector4() }, nrect: { value: nrect }, tint: { value: V3(meta.near_tint) }, rock: { value: V3(meta.rock) } }, extra)), vertexShader: VS, fragmentShader: FS });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(85000, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: U({}), vertexShader: `varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position + cameraPosition, 1.); }`,
    fragmentShader: `${COMMON} varying vec3 vD; void main() { gl_FragColor = vec4(sky(normalize(vD)), 1.); }` })));
  const [wideH, wideL, nfH, nfL, midH, midL, dh, dk, dl] = await Promise.all([bin('wide_h.f32', Float32Array), bin('wide_l.u8', Uint8Array), bin('nf_h.f32', Float32Array), bin('nf_l.u8', Uint8Array), bin('mid_h.f32', Float32Array), bin('mid_l.u8', Uint8Array),
    bin('detail_h.f32', Float32Array), bin('detail_k.u8', Uint8Array), bin('detail_l.u8', Uint8Array)]);
  scene.add(new THREE.Mesh(grid(wideH, Wd.n, Wd.m, Wd.box), terrain({ lmap: { value: dataTex(wideL, Wd.n, Wd.m, THREE.LinearFilter) }, mode: { value: 0 }, cutOn: { value: 1 }, cut: { value: shrink(nb, 30) } })));
  scene.add(new THREE.Mesh(grid(nfH, NF.n, NF.m, NF.box), terrain({ lmap: { value: dataTex(nfL, NF.n, NF.m, THREE.LinearFilter) }, mode: { value: 1 }, cutOn: { value: 1 }, cut: { value: shrink(rect(M.box), 12) } })));
  scene.add(new THREE.Mesh(grid(midH, M.n, M.m, M.box), terrain({ lmap: { value: dataTex(midL, M.n, M.m, THREE.LinearFilter) }, mode: { value: 1 }, cutOn: { value: 1 }, cut: { value: shrink(rect(D.box), 1.5 * meta.cell) } })));
  const n = D.n, lt = dataTex(dl, n, n, THREE.LinearFilter), kt = dataTex(dk, n, n, THREE.NearestFilter);
  scene.add(new THREE.Mesh(grid(dh, n, n, D.box), terrain({ lmap: { value: lt }, kmap: { value: kt }, mode: { value: 2 }, side: { value: n * meta.cell } })));

  // ---- buildings: the outline extruded from its foot to the eave, a pitched roof along the long axis ----
  const bld = await (await fetch(`data2/${name}/bld.json`)).json(), db = rect(D.box), sx = (db.y - db.x) / D.width_m, szs = (db.w - db.z) / D.depth_m;
  const P = [], C = [], LU = []; let count = 0;
  const tri = (a, b, c, col, lu) => { for (const v of [a, b, c]) { P.push(db.x + v[0] * sx, v[2], db.z + v[1] * szs); C.push(col[0] / 255, col[1] / 255, col[2] / 255); LU.push(lu[0], lu[1]); } };
  const clip = (pts, nx, nz, cx, cz, sign) => { const out = [], d = p => sign * ((p[0] - cx) * nx + (p[1] - cz) * nz);   // the half of an outline on one side of the ridge line
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], da = d(a), dbb = d(b);
      if (da >= 0) out.push(a); if ((da >= 0) !== (dbb >= 0)) { const t = da / (da - dbb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } }
    return out; };
  for (const b of bld.b) { if (b.skip) continue; count++;
    const pts = []; for (let i = 0; i < b.p.length; i += 2) pts.push([b.p[i], b.p[i + 1]]);
    const lu = [b.c[0] / D.width_m, b.c[1] / D.depth_m], ar = b.a * Math.PI / 180, nx = -Math.sin(ar), nz = Math.cos(ar);
    const dist = p => (p[0] - b.c[0]) * nx + (p[1] - b.c[1]) * nz, top = p => b.roof === 'gable' ? b.e + (b.r - b.e) * Math.max(0, 1 - Math.abs(dist(p)) / Math.max(b.hw, .5)) : b.r;
    const parts = b.roof === 'gable' ? [clip(pts, nx, nz, b.c[0], b.c[1], 1), clip(pts, nx, nz, b.c[0], b.c[1], -1)] : [pts];
    for (const part of parts) { if (part.length < 3) continue;
      const faces = THREE.ShapeUtils.triangulateShape(part.map(p => new THREE.Vector2(p[0], p[1])), []);
      for (const f of faces) tri(...f.map(i => [part[i][0], part[i][1], top(part[i])]), b.rc, lu);
      for (let i = 0; i < part.length; i++) { const a = part[i], c = part[(i + 1) % part.length];
        if (b.roof === 'gable' && Math.abs(dist(a)) < 1e-6 && Math.abs(dist(c)) < 1e-6) continue;       // the cut along the ridge is not a wall
        const a0 = [a[0], a[1], b.f], c0 = [c[0], c[1], b.f], a1 = [a[0], a[1], top(a)], c1 = [c[0], c[1], top(c)]; tri(a0, c0, c1, b.wc, lu); tri(a0, c1, a1, b.wc, lu); } } }
  if (count) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('luv', new THREE.Float32BufferAttribute(LU, 2)); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: U({ lmap: { value: lt } }),
      vertexShader: `attribute vec3 color; attribute vec2 luv; varying vec3 vC, vPos, vN; varying vec2 vL; void main() { vC = color; vL = luv; vPos = position; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `${COMMON} uniform sampler2D lmap; varying vec3 vC, vPos, vN; varying vec2 vL;
        void main() { vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; float up = abs(n.y), vis = texture2D(lmap, vL).r;
          float lam = up > .2 ? max(dot(vec3(n.x, abs(n.y), n.z), sunDir), 0.) : max(dot(n, sunDir), 0.);
          gl_FragColor = vec4(haze(vC * (amb + sunCol * lam * max(vis, .15)), vPos), 1.); }` }))); }
  window.__cells = count;
  renderer.render(scene, cam); window.__done = true;
})().catch(e => { window.__err = String(e && e.stack || e); });
