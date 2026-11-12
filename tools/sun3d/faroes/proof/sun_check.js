// sun.js (30 Dec 2026, Mountain time) against prep.py's dated copy: prints sun.js's answers for a few moments.
const fs = require('fs'); eval(fs.readFileSync(process.argv[2], 'utf8') + '; global.sunPos = sunPos;');
for (const [m, la, lo] of [[480, 43.7, -110.7], [720, 43.7, -110.7], [960, 43.7, -110.7], [600, 62.1, -7.43]]) { const s = sunPos(m, la, lo); console.log(m, la, lo, s.alt.toFixed(4), s.az.toFixed(4)); }
