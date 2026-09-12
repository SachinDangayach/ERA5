/* A direct port of ringemb/codec.py, so the page computes rather than replays. */
export const PRIMES = [5, 7, 11, 13, 17, 19, 23];
export const SLOTS = 5;
const TAU = Math.PI * 2;

function primitiveRoot(p) {
  const order = p - 1, factors = new Set();
  let m = order;
  for (let d = 2; d * d <= m; d++) while (m % d === 0) { factors.add(d); m /= d; }
  if (m > 1) factors.add(m);
  for (let g = 2; g < p; g++) {
    let ok = true;
    for (const f of factors) if (modpow(g, order / f, p) === 1) { ok = false; break; }
    if (ok) return g;
  }
  return 1;
}
function modpow(b, e, m) { let r = 1; b %= m; while (e > 0) { if (e & 1) r = (r * b) % m; b = (b * b) % m; e >>= 1; } return r; }

export class Codec {
  constructor(primes = PRIMES) {
    this.primes = primes;
    this.k = primes.length;
    this.dim = SLOTS * primes.length;
    this.M = primes.reduce((a, b) => a * b, 1);
    this.roots = primes.map(primitiveRoot);
    this.dlog = []; this.exp = [];
    primes.forEach((p, i) => {
      const dl = new Int32Array(p).fill(-1), ex = new Int32Array(p - 1);
      let cur = 1;
      for (let d = 0; d < p - 1; d++) { ex[d] = cur; dl[cur] = d; cur = (cur * this.roots[i]) % p; }
      this.dlog.push(dl); this.exp.push(ex);
    });
    // p legal slot patterns per prime, for maximum-likelihood decoding
    this.book = primes.map((p, i) => {
      const rows = [];
      for (let r = 0; r < p; r++) {
        const ca = Math.cos(TAU * r / p), sa = Math.sin(TAU * r / p);
        if (r === 0) rows.push([ca, sa, 1, 0, 1]);
        else { const d = this.dlog[i][r]; rows.push([ca, sa, Math.cos(TAU * d / (p - 1)), Math.sin(TAU * d / (p - 1)), 0]); }
      }
      return rows;
    });
  }
  residues(n) { n = ((n % this.M) + this.M) % this.M; return this.primes.map(p => n % p); }
  fromResidues(res) {
    const v = new Float64Array(this.dim);
    this.primes.forEach((p, i) => { const o = i * SLOTS, r = ((res[i] % p) + p) % p;
      for (let j = 0; j < SLOTS; j++) v[o + j] = this.book[i][r][j]; });
    return v;
  }
  encode(n) { return this.fromResidues(this.residues(n)); }

  decodeML(vec) {
    const res = [], margin = [];
    this.primes.forEach((p, i) => {
      const o = i * SLOTS; let best = Infinity, second = Infinity, arg = 0;
      for (let r = 0; r < p; r++) {
        let d2 = 0;
        for (let j = 0; j < SLOTS; j++) { const e = vec[o + j] - this.book[i][r][j]; d2 += e * e; }
        if (d2 < best) { second = best; best = d2; arg = r; } else if (d2 < second) second = d2;
      }
      res.push(arg); margin.push(second - best);
    });
    return { res, margin };
  }
  decodePhase(vec) {
    return this.primes.map((p, i) => {
      const o = i * SLOTS, ang = Math.atan2(vec[o + 1], vec[o]);
      return ((Math.round(ang * p / TAU) % p) + p) % p;
    });
  }
  crtSubset(res, keep) {
    let mod = 1; keep.forEach(i => mod *= this.primes[i]);
    let acc = 0n; const bmod = BigInt(mod);
    keep.forEach(i => {
      const p = this.primes[i], mi = mod / p;
      let inv = 1; for (let x = 1; x < p; x++) if ((mi % p) * x % p === 1) { inv = x; break; }
      acc = (acc + BigInt(res[i]) * BigInt(mi) * BigInt(inv)) % bmod;
    });
    return Number(acc);
  }
  payload(redundancy = 2) {
    if (redundancy <= 0) return this.M;
    const sorted = [...this.primes].sort((a, b) => a - b);
    let mod = this.M;
    sorted.slice(sorted.length - redundancy).forEach(p => { mod /= p; });
    return mod;
  }
  robust(res, redundancy = 2) {
    const pay = this.payload(redundancy), maxDrop = Math.floor(redundancy / 2);
    const all = [...Array(this.k).keys()];
    // every subset obtained by discarding up to maxDrop primes, as in
    // reconstruct_residues(): r redundant residues correct floor(r/2) errors
    const subsets = [];
    const walk = (start, drop) => {
      subsets.push(all.filter(j => !drop.includes(j)));
      if (drop.length >= maxDrop) return;
      for (let i = start; i < this.k; i++) walk(i + 1, drop.concat(i));
    };
    walk(0, []);
    let bestN = 0, bestScore = -1, dropped = null;
    subsets.forEach(keep => {
      let mod = 1; keep.forEach(i => mod *= this.primes[i]);
      if (mod < pay) return;
      const n = this.crtSubset(res, keep);
      if (n >= pay) return;
      let agree = 0;
      this.primes.forEach((p, i) => { if (n % p === res[i]) agree++; });
      if (agree > bestScore) { bestScore = agree; bestN = n; dropped = all.filter(i => !keep.includes(i)); }
    });
    return { n: bestN, score: bestScore, dropped };
  }
  cmul(ac, as_, bc, bs) { return [ac * bc - as_ * bs, ac * bs + as_ * bc]; }
  addRaw(u, v) {
    const o = Float64Array.from(u);
    this.primes.forEach((p, i) => { const b = i * SLOTS;
      const [c, s] = this.cmul(u[b], u[b + 1], v[b], v[b + 1]); o[b] = c; o[b + 1] = s; });
    return o;
  }
  mulRaw(u, v) {
    const o = Float64Array.from(u);
    this.primes.forEach((p, i) => { const b = i * SLOTS;
      const [c, s] = this.cmul(u[b + 2], u[b + 3], v[b + 2], v[b + 3]);
      o[b + 2] = c; o[b + 3] = s; o[b + 4] = 1 - (1 - u[b + 4]) * (1 - v[b + 4]); });
    return o;
  }
  canonicalize(vec, channel) {
    const res = channel === "mul" ? this.mulResidues(vec) : this.decodePhase(vec);
    return this.fromResidues(res);
  }
  mulResidues(vec) {
    return this.primes.map((p, i) => {
      const o = i * SLOTS;
      if (vec[o + 4] > 0.5) return 0;
      const ang = Math.atan2(vec[o + 3], vec[o + 2]);
      let d = Math.round(ang * (p - 1) / TAU) % (p - 1); if (d < 0) d += p - 1;
      return this.exp[i][d];
    });
  }
  add(u, v) { return this.canonicalize(this.addRaw(u, v), "add"); }
  mul(u, v) { return this.canonicalize(this.mulRaw(u, v), "mul"); }

  neg(u) {
    const o = Float64Array.from(u);
    this.primes.forEach((p, i) => { o[i * SLOTS + 1] *= -1; });
    return this.canonicalize(o, "add");
  }
  sub(u, v) { return this.canonicalize(this.addRaw(u, this.neg(v)), "add"); }

  /* Integer power: scale the multiplicative angle by k. */
  powk(u, k) {
    const o = Float64Array.from(u);
    this.primes.forEach((p, i) => {
      const b = i * SLOTS, ang = Math.atan2(u[b + 3], u[b + 2]) * k;
      o[b + 2] = Math.cos(ang); o[b + 3] = Math.sin(ang);
      if (k <= 0) o[b + 4] = 0;
    });
    return this.canonicalize(o, "mul");
  }
  inv(u) { return this.powk(u, -1); }
  div(u, v) { return this.mul(u, this.inv(v)); }

  /* The block's own certificate: a divisor is invertible exactly when every
     zero flag is off.  A purely local read -- no decoding needed. */
  isInvertible(vec) {
    return this.primes.every((p, i) => vec[i * SLOTS + 4] < 0.5);
  }
}

/* Ground truth in exact integer arithmetic, for the comparison. */
export function modInv(a, m) {
  let [old_r, r] = [((a % m) + m) % m, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) return null;            // not coprime -> no inverse
  return ((old_s % m) + m) % m;
}
export function intResult(op, a, b, M) {
  const A = BigInt(a), B = BigInt(b), m = BigInt(M);
  if (op === "add") return Number(((A + B) % m + m) % m);
  if (op === "sub") return Number(((A - B) % m + m) % m);
  if (op === "mul") return Number((A * B) % m);
  const inv = modInv(B, m);
  return inv === null ? null : Number((A * inv) % m);
}

/* A port of ringemb/rationals.py -- lattice rational reconstruction, the
   half-extended-Euclid trick.  Recovers the unique a/b with |a|, b <= bound
   such that a/b == u (mod M), or null when no such rational exists. */
export function rationalReconstruct(u, M, bound) {
  const m = BigInt(M), bd = BigInt(bound);
  let uu = ((BigInt(u) % m) + m) % m;
  if (uu === 0n) return { a: 0, b: 1 };
  let r0 = m, r1 = uu, s0 = 0n, s1 = 1n;
  while (r1 > bd) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  let a = r1, b = s1;
  if (b < 0n) { a = -a; b = -b; }
  const abs = x => (x < 0n ? -x : x);
  let g = abs(a), h = b;
  while (h) { [g, h] = [h, g % h]; }
  if (b === 0n || b > bd || (g !== 1n && !(a === 0n && b === 1n))) return null;
  if (((a - b * uu) % m + m) % m !== 0n) return null;
  return { a: Number(a), b: Number(b) };
}

export function isqrtBig(n) {
  let x = BigInt(n), y = (x + 1n) / 2n, r = x;
  if (x < 2n) return Number(x);
  while (y < r) { r = y; y = (y + x / y) / 2n; }
  return Number(r);
}

/* Box-Muller, so the noise demo matches the numpy experiment. */
export function gauss(rand = Math.random) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}
