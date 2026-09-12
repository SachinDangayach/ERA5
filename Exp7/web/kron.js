/* A port of ringemb/kronecker.py -- the EXISTING word block that problem 1
   leaves untouched.  The recipe is identical: a fixed byte matrix, a fixed
   positional matrix, mean-pool over the token's UTF-8 bytes, never trained.

   The random draw differs from the Python run (numpy's PCG64 stream is not
   reproducible here), so the individual numbers on the page are not the same
   numbers the experiment used.  Everything the page claims about this block
   -- that it is deterministic, untrained, and computed from spelling -- is a
   property of the recipe, not of the draw.                                   */

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* UTF-8 bytes without TextEncoder, so this also runs under the smoketest shim. */
export function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const lo = str.charCodeAt(++i);
      c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63),
               0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

export class KroneckerWordBlock {
  constructor(dWord = 64, window = 32, seed = 0) {
    this.dWord = dWord;
    this.window = window;
    const rand = mulberry32(seed + 1);
    const scale = 1 / Math.sqrt(dWord);
    const normal = () => {
      let u = 0, v = 0;
      while (u === 0) u = rand();
      while (v === 0) v = rand();
      return scale * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    this.byteMatrix = Array.from({ length: 256 },
      () => Float64Array.from({ length: dWord }, normal));
    this.posMatrix = Array.from({ length: window },
      () => Float64Array.from({ length: dWord }, normal));
  }

  encodeOne(token) {
    const raw = utf8Bytes(token).slice(0, this.window);
    const v = new Float64Array(this.dWord);
    if (!raw.length) return v;
    raw.forEach((byte, j) => {
      const bm = this.byteMatrix[byte], pm = this.posMatrix[j];
      for (let d = 0; d < this.dWord; d++) v[d] += bm[d] + pm[d];
    });
    for (let d = 0; d < this.dWord; d++) v[d] /= raw.length;
    return v;
  }

  truncated(token) { return utf8Bytes(token).length > this.window; }
}
