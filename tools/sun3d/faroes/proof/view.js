// Proof renderer (standalone, three.js r128): one view of a Faroes detail box, BEFORE (the 4 m grid, plain colours, as the
// app draws today) or AFTER (the detail box: 1-2 m ground + building blocks + water mask + the aerial photo as colour).
// view.html?v=<name>&mode=before|after[&f=<focal mm>]   data from prep.py in data/<name>/. Sets window.__done when drawn.
(async () => {
  const q = new URLSearchParams(location.search), name = q.get('v'), after = q.get('mode') === 'after', W = +(q.get('w') || 1500), H = +(q.get('h') || 1200);
  const meta = await (await fetch(`data/${name}/meta.json`)).json();
  const bin = async (f, T) => new T(await (await fetch(`data/${name}/${f}`)).arrayBuffer());
  const [slat, slng] = meta.stand, kx = meta.kx, kz = meta.kz, X = lng => (lng - slng) * kx, Z = lat => -(lat - slat) * kz;
  const focal = +(q.get('f') || meta.lens), RE = 6371000 * 7 / 6;
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(2 * Math.atan(48 / focal) * 180 / Math.PI, W / H, 1, 90000);   // 4x5 film, landscape: 120 x 96 mm
  const eyeY = (after ? meta.eye_after : meta.eye_before) + 1.6;
  cam.position.set(0, eyeY, 0); cam.lookAt(X(meta.subject[1]), meta.subject_h + meta.aim_up, Z(meta.subject[0]));
  const sa = meta.sun.alt * Math.PI / 180, sz = meta.sun.az * Math.PI / 180;
  const sunDir = new THREE.Vector3(Math.sin(sz) * Math.cos(sa), Math.sin(sa), -Math.cos(sz) * Math.cos(sa));
  const k = Math.min(1, Math.max(0, meta.sun.alt / 25)), ks = k * k * (3 - 2 * k);
  const sunCol = new THREE.Vector3(1.0, 0.62 + 0.33 * ks, 0.38 + 0.50 * ks).multiplyScalar(0.92);
  const amb = new THREE.Vector3(0.30, 0.34, 0.40), fogCol = new THREE.Vector3(0.74, 0.80, 0.86);
  const U = extra => Object.assign({ sunDir: { value: sunDir }, sunCol: { value: sunCol }, amb: { value: amb }, fogCol: { value: fogCol }, fogD: { value: 55000 }, camPos: { value: cam.position } }, extra);

  const dataTex = (a, n, m, filter) => { const t = new THREE.DataTexture(a, m, n, THREE.LuminanceFormat, THREE.UnsignedByteType); t.minFilter = t.magFilter = filter; t.flipY = false; t.needsUpdate = true; return t; };
  function grid(h, n, m, box) {   // cell-centred heights -> a mesh in local metres (x east, y up, z south), the earth's curve taken off
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
  // the plain look: the colours of the app's page today (tools/sun3d/app_view.js, ground 'green')
  // AFTER: the far ground's grass takes the photo's own middle colour (uniform tint), so the box does not sit in it like a stamp
  const PLAIN = `uniform vec3 tint; uniform float useTint;
    vec3 plain(vec3 pos, float h, float slope) { float fine = hash(floor(pos.xz / 4.)), pch = vnoise(pos.xz / 300.) * .6 + vnoise(pos.xz / 90.) * .4;
      float rock = smoothstep(33., 50., slope + fine * 7.);
      vec3 grass = mix(vec3(.25, .36, .16), vec3(.37, .38, .22), smoothstep(120., 620., h + pch * 160.));
      if (useTint > .5) { vec3 t = mix(vec3(dot(tint, vec3(.3, .55, .15))), tint, .75) * .9; grass = mix(grass, mix(t, t * vec3(1.06, .93, .82), smoothstep(120., 620., h + pch * 160.)) * (.92 + .16 * pch), .7); fine *= .4; }
      return mix(grass + fine * .05, vec3(.34, .32, .31) + fine * .06, rock); }
    vec3 cliff(vec3 pos) { float band = vnoise(vec2(pos.y * .45, (pos.x + pos.z) * .02)), streak = vnoise(vec2((pos.x - pos.z) * .9, pos.y * .06));
      return mix(vec3(.22, .21, .20), vec3(.40, .37, .34), band * .65 + streak * .35) * (1. + .25 * step(.8, vnoise(vec2(pos.y * .2, 3.))) * vec3(.2, .5, .1)); }`;
  const FS = `${COMMON} ${PLAIN}
    uniform sampler2D lmap, photo, kmap; uniform float usePhoto, side, cutOn, realWater, cells; uniform vec4 cut;
    varying vec2 vUv; varying vec3 vPos; varying vec3 vN; varying float vH;
    void main() {
      if (cutOn > .5 && vPos.x > cut.x && vPos.x < cut.y && vPos.z > cut.z && vPos.z < cut.w) discard;
      vec3 n = normalize(vN); float slope = degrees(acos(clamp(n.y, -1., 1.)));
      float vis = texture2D(lmap, vUv).r, lam = max(dot(n, sunDir), 0.);
      vec3 alb = plain(vPos, vH, slope); bool sea = vH < .6; float kind = 0.;
      float fall = 0.;
      if (usePhoto > .5) {
        float e = min(min(vUv.x, 1. - vUv.x), min(vUv.y, 1. - vUv.y)) * side;
        vec3 ph = texture2D(photo, vUv).rgb;
        float dcam = length(camPos - vPos);                               // the photo is 0.5 to 1 m a pixel: a little grain close to the camera
        ph *= 1. + (1. - smoothstep(15., 120., dcam)) * (.22 * (vnoise(vPos.xz * 6.) - .5) + .16 * (vnoise(vPos.xz * 23.) - .5));
        ph = mix(ph, cliff(vPos), smoothstep(52., 70., slope));          // a photo from above has nothing to say about an upright face
        alb = mix(alb, ph, smoothstep(4., 44., e));
        kind = floor(texture2D(kmap, vUv).r * 255. + .5);
        // a stream that reaches a steep face falls down it: the class of the cell uphill of this point
        vec2 upv = length(n.xz) > .01 ? -normalize(n.xz) / cells : vec2(0.);
        float ku = floor(texture2D(kmap, vUv + upv * 1.2).r * 255. + .5), ku2 = floor(texture2D(kmap, vUv + upv * 2.4).r * 255. + .5);
        if (slope > 42. && (kind == 4. || ku == 4. || ku2 == 4.)) fall = 1.;
      }
      vec3 col = alb * (amb + sunCol * lam * vis);
      if (fall > .5) col = mix(vec3(.86, .90, .93), vec3(.97), vnoise(vec2(vPos.x * 3. + vPos.z * 3., vPos.y * .35))) * (amb * 1.25 + sunCol * (.3 + .6 * lam) * vis);
      else if (usePhoto > .5 && kind >= 3. && slope < 25.) {
        if (sea || vH < .6) col = waterCol(vPos, vis);
        else if (kind == 3.) col = mix(col, waterCol(vPos, vis), .92);                                           // a lake
        else col = mix(col, waterCol(vPos, vis), .45);                                                           // a stream on its bed
      } else if (sea) col = realWater > .5 ? waterCol(vPos, vis) : vec3(.07, .16, .24) * (amb + sunCol * lam * vis);
      gl_FragColor = vec4(haze(col, vPos), 1.);
    }`;
  const terrain = extra => new THREE.ShaderMaterial({ uniforms: U(Object.assign({ lmap: { value: null }, photo: { value: null }, kmap: { value: null }, usePhoto: { value: 0 }, side: { value: 1 }, cells: { value: 1024 }, tint: { value: new THREE.Vector3(meta.tint[0], meta.tint[1], meta.tint[2]) }, useTint: { value: after ? 1 : 0 }, cutOn: { value: 0 }, cut: { value: new THREE.Vector4() }, realWater: { value: after ? 1 : 0 } }, extra)), vertexShader: VS, fragmentShader: FS });
  const rect = box => new THREE.Vector4(X(box[2]), X(box[3]), Z(box[0]), Z(box[1]));
  const shrink = (v, d) => new THREE.Vector4(v.x + d, v.y - d, v.z + d, v.w - d);

  // sky
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(85000, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: U({}), vertexShader: `varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position + cameraPosition, 1.); }`,
    fragmentShader: `${COMMON} varying vec3 vD; void main() { gl_FragColor = vec4(sky(normalize(vD)), 1.); }` })));

  const D = meta.detail, M = meta.mid, Wd = meta.wide;
  const [wideH, wideL, midH, midL] = await Promise.all([bin('wide_h.f32', Float32Array), bin('wide_l.u8', Uint8Array), bin('mid_h.f32', Float32Array), bin('mid_l.u8', Uint8Array)]);
  const mw = terrain({ lmap: { value: dataTex(wideL, Wd.n, Wd.m, THREE.LinearFilter) }, cutOn: { value: 1 }, cut: { value: shrink(rect(M.box), 20) } });
  scene.add(new THREE.Mesh(grid(wideH, Wd.n, Wd.m, Wd.box), mw));
  const mm = terrain({ lmap: { value: dataTex(midL, M.n, M.m, THREE.LinearFilter) }, cutOn: { value: after ? 1 : 0 }, cut: { value: shrink(rect(D.box), 1.5 * meta.cell) } });
  scene.add(new THREE.Mesh(grid(midH, M.n, M.m, M.box), mm));
  if (after) {
    const [dh, ds, dk, dl] = await Promise.all([bin('detail_h.f32', Float32Array), bin('detail_s.f32', Float32Array), bin('detail_k.u8', Uint8Array), bin('detail_l.u8', Uint8Array)]);
    const photo = await new Promise(r => new THREE.TextureLoader().load(`data/${name}/photo.jpg`, r)); photo.flipY = false; photo.minFilter = THREE.LinearMipmapLinearFilter; photo.anisotropy = renderer.capabilities.getMaxAnisotropy(); photo.needsUpdate = true;
    const n = D.n, lt = dataTex(dl, n, n, THREE.LinearFilter), kt = dataTex(dk, n, n, THREE.NearestFilter), side = n * meta.cell;
    scene.add(new THREE.Mesh(grid(dh, n, n, D.box), terrain({ lmap: { value: lt }, photo: { value: photo }, kmap: { value: kt }, usePhoto: { value: 1 }, side: { value: side } })));
    // buildings: every building cell is a flat-roofed block, walls upright down to the ground of the cell beside it
    const [north, south, west, east] = D.box, dla = (north - south) / n, dlo = (east - west) / n, P = [], UV = [], NR = [], WL = [], LU = [];
    const BS = [];
    const quad = (a, b, c, d, nx, ny, nz, wall, uvs, lu) => { const lo = Math.min(a[1], b[1], c[1], d[1]); for (const t of [0, 1, 2, 0, 2, 3]) { const v = [a, b, c, d][t]; P.push(v[0], v[1], v[2]); NR.push(nx, ny, nz); WL.push(wall); BS.push(lo); UV.push(uvs[t][0], uvs[t][1]); LU.push(lu[0], lu[1]); } };
    let cells = 0;
    for (let i = 1; i < n - 1; i++) for (let j = 1; j < n - 1; j++) { const p = i * n + j; if (dk[p] !== 2) continue; cells++;
      const x0 = X(west + j * dlo), x1 = X(west + (j + 1) * dlo), z0 = Z(north - i * dla), z1 = Z(north - (i + 1) * dla), y = ds[p], u0 = j / n, u1 = (j + 1) / n, v0 = i / n, v1 = (i + 1) / n, cu = [(j + .5) / n, (i + .5) / n];
      quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], 0, 1, 0, 0, [[u0, v0], [u0, v1], [u1, v1], [u1, v0]], cu);
      for (const [di, dj, a, b, nx, nz] of [[-1, 0, [x1, z0], [x0, z0], 0, -1], [1, 0, [x0, z1], [x1, z1], 0, 1], [0, -1, [x0, z0], [x0, z1], -1, 0], [0, 1, [x1, z1], [x1, z0], 1, 0]]) {
        const o = (i + di) * n + (j + dj), yo = dk[o] === 2 ? ds[o] : dh[o]; if (yo >= y - .05) continue;
        const lu = [(j + dj + .5) / n, (i + di + .5) / n];
        quad([a[0], y, a[1]], [a[0], yo, a[1]], [b[0], yo, b[1]], [b[0], y, b[1]], nx, 0, nz, 1, [cu, cu, cu, cu], lu); } }
    if (cells) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(NR, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      g.setAttribute('wall', new THREE.Float32BufferAttribute(WL, 1)); g.setAttribute('base', new THREE.Float32BufferAttribute(BS, 1)); g.setAttribute('luv', new THREE.Float32BufferAttribute(LU, 2));
      scene.add(new THREE.Mesh(g, new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: U({ lmap: { value: lt }, photo: { value: photo } }),
        vertexShader: `attribute float wall; attribute float base; attribute vec2 luv; varying vec2 vUv, vL; varying vec3 vPos, vN; varying float vW, vBase; void main() { vUv = uv; vL = luv; vPos = position; vN = normal; vW = wall; vBase = base; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `${COMMON} uniform sampler2D lmap, photo; varying vec2 vUv, vL; varying vec3 vPos, vN; varying float vW, vBase;
          void main() { vec3 roof = texture2D(photo, vUv).rgb; float vis = texture2D(lmap, vL).r, lam = max(dot(normalize(vN), sunDir), 0.);
            // roofs take the photo; walls cannot be seen from above: a neutral wall, a little of the roof's own tone in it
            // (the roof's own colour, greyed and darkened toward the foot: every house gets a body of its own)
            vec3 alb = vW > .5 ? mix(vec3(.58, .56, .53), roof, .55) * (.72 + .28 * smoothstep(0., 3., vPos.y - vBase)) : roof;
            gl_FragColor = vec4(haze(alb * (amb + sunCol * lam * (vW > .5 ? max(vis, .0) : vis)), vPos), 1.); }` })));
    }
    window.__cells = cells;
  }
  renderer.render(scene, cam); window.__done = true;
})().catch(e => { window.__err = String(e && e.stack || e); });
