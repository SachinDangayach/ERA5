/* A port of ringemb/linear_refresh.py, so the E5 panel computes rather than
   replays.  Stores the FULL character basis per prime instead of one harmonic,
   which turns both refreshes into fixed matrix multiplies.

   layout per prime p, 4p-1 reals:
     [0, p)          Re A   additive characters   A_k = exp(2pi i k r / p)
     [p, 2p)         Im A
     [2p, 3p-1)      Re X   multiplicative chars  X_j = exp(2pi i j dlog(r) / (p-1))
     [3p-1, 4p-2)    Im X
     [4p-2]          z      the zero flag                                        */

/* n-by-n DFT matrix, entry [a*n + b] = scale * exp(sign * 2*pi*i*a*b / n). */
function dftMatrix(n, sign, scale) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const ang = sign * 2 * Math.PI * ((a * b) % n) / n;
      re[a * n + b] = scale * Math.cos(ang);
      im[a * n + b] = scale * Math.sin(ang);
    }
  }
  return { n, re, im };
}

export class LinearCodec {
  constructor(primes = PRIMES) {
    this.base = new Codec(primes);
    this.primes = this.base.primes;
    this.k = this.primes.length;
    this.M = this.base.M;
    this.sizes = this.primes.map(p => 4 * p - 1);
    this.offsets = [0];
    this.sizes.forEach(s => this.offsets.push(this.offsets[this.offsets.length - 1] + s));
    this.dim = this.offsets[this.k];

    this.F = []; this.Finv = []; this.G = []; this.Ginv = [];
    this.primes.forEach(p => {
      this.F.push(dftMatrix(p, +1, 1));
      this.Finv.push(dftMatrix(p, -1, 1 / p));
      this.G.push(dftMatrix(p - 1, +1, 1));
      this.Ginv.push(dftMatrix(p - 1, -1, 1 / (p - 1)));
    });
  }

  /* --- packing ------------------------------------------------------- */
  _pack(out, i, Are, Aim, Xre, Xim, z) {
    const p = this.primes[i], o = this.offsets[i];
    for (let t = 0; t < p; t++) { out[o + t] = Are[t]; out[o + p + t] = Aim[t]; }
    for (let t = 0; t < p - 1; t++) {
      out[o + 2 * p + t] = Xre[t];
      out[o + 3 * p - 1 + t] = Xim[t];
    }
    out[o + 4 * p - 2] = z;
  }
  _unpack(vec, i) {
    const p = this.primes[i], o = this.offsets[i];
    return {
      Are: vec.subarray(o, o + p), Aim: vec.subarray(o + p, o + 2 * p),
      Xre: vec.subarray(o + 2 * p, o + 3 * p - 1),
      Xim: vec.subarray(o + 3 * p - 1, o + 4 * p - 2),
      z: vec[o + 4 * p - 2],
    };
  }

  /* --- encode / decode ------------------------------------------------ */
  encode(n) {
    const N = ((n % this.M) + this.M) % this.M;
    const out = new Float64Array(this.dim);
    this.primes.forEach((p, i) => {
      const r = N % p, F = this.F[i], G = this.G[i];
      const Are = new Float64Array(p), Aim = new Float64Array(p);
      // delta is the indicator of r, so A is simply column r of F
      for (let t = 0; t < p; t++) { Are[t] = F.re[t * p + r]; Aim[t] = F.im[t * p + r]; }
      const Xre = new Float64Array(p - 1), Xim = new Float64Array(p - 1);
      if (r !== 0) {
        const d = this.base.dlog[i][r];
        for (let t = 0; t < p - 1; t++) {
          Xre[t] = G.re[t * (p - 1) + d];
          Xim[t] = G.im[t * (p - 1) + d];
        }
      }
      this._pack(out, i, Are, Aim, Xre, Xim, r === 0 ? 1 : 0);
    });
    return out;
  }

  /* delta = A @ Finv^T, taken back to the residue indicator. */
  deltaFromAdd(vec, i) {
    const p = this.primes[i], Fi = this.Finv[i], { Are, Aim } = this._unpack(vec, i);
    const re = new Float64Array(p), im = new Float64Array(p);
    for (let r = 0; r < p; r++) {
      let sr = 0, si = 0;
      for (let t = 0; t < p; t++) {
        const fr = Fi.re[r * p + t], fi = Fi.im[r * p + t];
        sr += Are[t] * fr - Aim[t] * fi;
        si += Are[t] * fi + Aim[t] * fr;
      }
      re[r] = sr; im[r] = si;
    }
    return { re, im };
  }

  decode(vec) {
    const res = this.primes.map((p, i) => {
      const d = this.deltaFromAdd(vec, i);
      let best = -Infinity, arg = 0;
      for (let r = 0; r < p; r++) if (d.re[r] > best) { best = d.re[r]; arg = r; }
      return arg;
    });
    return this.base.crtSubset(res, [...Array(this.k).keys()]);
  }

  /* --- the two refreshes, both fixed linear maps ----------------------- */
  refreshFromAdd(vec) {
    const out = Float64Array.from(vec);
    this.primes.forEach((p, i) => {
      const G = this.G[i], dlog = this.base.dlog[i];
      const d = this.deltaFromAdd(vec, i);
      // X = delta @ (G Q)^T, where (G Q)[j, r] = G[j, dlog(r)] and column 0 is 0
      const Xre = new Float64Array(p - 1), Xim = new Float64Array(p - 1);
      for (let j = 0; j < p - 1; j++) {
        let sr = 0, si = 0;
        for (let r = 1; r < p; r++) {
          const gr = G.re[j * (p - 1) + dlog[r]], gi = G.im[j * (p - 1) + dlog[r]];
          sr += d.re[r] * gr - d.im[r] * gi;
          si += d.re[r] * gi + d.im[r] * gr;
        }
        Xre[j] = sr; Xim[j] = si;
      }
      const { Are, Aim } = this._unpack(vec, i);
      this._pack(out, i, Are, Aim, Xre, Xim, d.re[0]);
    });
    return out;
  }

  refreshFromMul(vec) {
    const out = Float64Array.from(vec);
    this.primes.forEach((p, i) => {
      const Gi = this.Ginv[i], dlog = this.base.dlog[i];
      const { Xre, Xim, z } = this._unpack(vec, i);
      // delta = X @ (Ginv^T Q), then delta[0] += z
      const dre = new Float64Array(p), dim = new Float64Array(p);
      for (let r = 1; r < p; r++) {
        const row = dlog[r];
        let sr = 0, si = 0;
        for (let j = 0; j < p - 1; j++) {
          const gr = Gi.re[row * (p - 1) + j], gi = Gi.im[row * (p - 1) + j];
          sr += Xre[j] * gr - Xim[j] * gi;
          si += Xre[j] * gi + Xim[j] * gr;
        }
        dre[r] = sr; dim[r] = si;
      }
      dre[0] += z;
      const F = this.F[i];
      const Are = new Float64Array(p), Aim = new Float64Array(p);
      for (let t = 0; t < p; t++) {
        let sr = 0, si = 0;
        for (let r = 0; r < p; r++) {
          const fr = F.re[t * p + r], fi = F.im[t * p + r];
          sr += dre[r] * fr - dim[r] * fi;
          si += dre[r] * fi + dim[r] * fr;
        }
        Are[t] = sr; Aim[t] = si;
      }
      this._pack(out, i, Are, Aim, Xre, Xim, z);
    });
    return out;
  }

  /* --- the two compositions ------------------------------------------- */
  add(u, v) {
    const out = Float64Array.from(u);
    this.primes.forEach((p, i) => {
      const a = this._unpack(u, i), b = this._unpack(v, i), o = this.offsets[i];
      for (let t = 0; t < p; t++) {
        out[o + t] = a.Are[t] * b.Are[t] - a.Aim[t] * b.Aim[t];
        out[o + p + t] = a.Are[t] * b.Aim[t] + a.Aim[t] * b.Are[t];
      }
    });
    return this.refreshFromAdd(out);
  }

  mul(u, v) {
    const out = Float64Array.from(u);
    this.primes.forEach((p, i) => {
      const a = this._unpack(u, i), b = this._unpack(v, i), o = this.offsets[i];
      for (let t = 0; t < p - 1; t++) {
        out[o + 2 * p + t] = a.Xre[t] * b.Xre[t] - a.Xim[t] * b.Xim[t];
        out[o + 3 * p - 1 + t] = a.Xre[t] * b.Xim[t] + a.Xim[t] * b.Xre[t];
      }
      out[o + 4 * p - 2] = a.z + b.z - a.z * b.z;
    });
    return this.refreshFromMul(out);
  }
}
