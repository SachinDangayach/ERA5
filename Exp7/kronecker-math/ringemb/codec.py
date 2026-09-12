"""
ringemb.codec -- the "math block" that gets appended to a Kronecker embedding.

The idea in one line
--------------------
An integer n is stored as a bundle of *phases*.  Two different phase families
live side by side:

    additive phase        alpha_p(n) = 2*pi * (n mod p) / p
    multiplicative phase  mu_p(n)    = 2*pi * dlog_g(n mod p) / (p-1)

Adding integers adds the additive phases.  Multiplying integers adds the
multiplicative phases (that is what a discrete logarithm is for).  Adding a
phase is *complex multiplication* of the stored (cos, sin) pair, so both
integer operations become one primitive on the vector -- an elementwise
complex product on the relevant channel group.

Because the phases are taken modulo several coprime primes, the Chinese
Remainder Theorem reconstructs the exact integer from them.  Nothing is
learned, nothing is approximate: the code below is exact up to float64
rounding, over the whole range [0, M) with M = prod(primes).

Layout
------
For each prime p the block spends SLOTS_PER_PRIME = 5 real numbers:

    [ cos(alpha_p), sin(alpha_p), cos(mu_p), sin(mu_p), zero_flag_p ]

zero_flag_p is 1.0 when n = 0 (mod p), where the discrete log is undefined.
With the default 7 primes the block is 35 real dimensions and covers
0 .. 37,182,144.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

import numpy as np

DEFAULT_PRIMES: tuple[int, ...] = (5, 7, 11, 13, 17, 19, 23)
SLOTS_PER_PRIME = 5

TAU = 2.0 * math.pi


def _primitive_root(p: int) -> int:
    """Smallest primitive root modulo the prime p."""
    if p == 2:
        return 1
    order = p - 1
    factors = set()
    m = order
    d = 2
    while d * d <= m:
        while m % d == 0:
            factors.add(d)
            m //= d
        d += 1
    if m > 1:
        factors.add(m)
    for g in range(2, p):
        if all(pow(g, order // f, p) != 1 for f in factors):
            return g
    raise ValueError(f"no primitive root found for {p}")


def _phase(values: np.ndarray, modulus: int) -> tuple[np.ndarray, np.ndarray]:
    ang = TAU * (values.astype(np.float64) / modulus)
    return np.cos(ang), np.sin(ang)


def _unphase(cos_v: np.ndarray, sin_v: np.ndarray, modulus: int) -> tuple[np.ndarray, np.ndarray]:
    """Round a (cos, sin) pair back to the nearest lattice point of Z_modulus.

    Returns the recovered residues and the absolute angular distance to the
    nearest lattice point (a per-slot confidence, used by the noise study).
    """
    ang = np.arctan2(sin_v, cos_v)
    scaled = ang * (modulus / TAU)
    residue = np.rint(scaled)
    err = np.abs(scaled - residue)
    return (residue.astype(np.int64) % modulus), err


class MathCodec:
    """Encode / decode / compute with the appended math block."""

    def __init__(self, primes: Sequence[int] = DEFAULT_PRIMES):
        self.primes = tuple(int(p) for p in primes)
        self.k = len(self.primes)
        self.dim = SLOTS_PER_PRIME * self.k
        self.M = 1
        for p in self.primes:
            self.M *= p

        self.roots = tuple(_primitive_root(p) for p in self.primes)

        # dlog[i][r] = discrete log of r base g_i (mod p_i);  dlog[i][0] is unused.
        # exp[i][d]  = g_i ** d (mod p_i)
        self.dlog: list[np.ndarray] = []
        self.exp: list[np.ndarray] = []
        for p, g in zip(self.primes, self.roots):
            dl = np.full(p, -1, dtype=np.int64)
            ex = np.zeros(p - 1, dtype=np.int64)
            cur = 1
            for d in range(p - 1):
                ex[d] = cur
                dl[cur] = d
                cur = (cur * g) % p
            self.dlog.append(dl)
            self.exp.append(ex)

        # CRT coefficients: n = sum_i r_i * c_i  (mod M)
        self.crt_coeff: list[int] = []
        for p in self.primes:
            m_i = self.M // p
            self.crt_coeff.append(m_i * pow(m_i, -1, p))

        # Per-prime codebook: the p legal 5-dim slot patterns.  Used by the
        # maximum-likelihood decoder, which beats reading a single phase
        # because every residue is stored TWICE (additive phase and
        # multiplicative phase) plus a zero flag.
        self.codewords: list[np.ndarray] = []
        for i, pr in enumerate(self.primes):
            book = np.zeros((pr, SLOTS_PER_PRIME), dtype=np.float64)
            for r in range(pr):
                ca, sa = math.cos(TAU * r / pr), math.sin(TAU * r / pr)
                if r == 0:
                    cm, sm, z = 1.0, 0.0, 1.0
                else:
                    d = int(self.dlog[i][r])
                    cm, sm, z = math.cos(TAU * d / (pr - 1)), math.sin(TAU * d / (pr - 1)), 0.0
                book[r] = (ca, sa, cm, sm, z)
            self.codewords.append(book)

        # slot indices, handy for slicing tensors elsewhere
        base = np.arange(self.k) * SLOTS_PER_PRIME
        self.idx_add_cos = base + 0
        self.idx_add_sin = base + 1
        self.idx_mul_cos = base + 2
        self.idx_mul_sin = base + 3
        self.idx_zero = base + 4

    # ------------------------------------------------------------------ #
    # encoding
    # ------------------------------------------------------------------ #
    def residues(self, n: np.ndarray) -> np.ndarray:
        """(B,) integers -> (B, k) residues, valid for negative n as well."""
        n = np.asarray(n, dtype=object if np.asarray(n).dtype == object else np.int64)
        n = np.asarray(n, dtype=np.int64) % self.M
        return np.stack([n % p for p in self.primes], axis=-1)

    def from_residues(self, res: np.ndarray) -> np.ndarray:
        """(B, k) residues -> (B, dim) canonical math block."""
        res = np.asarray(res, dtype=np.int64)
        out = np.zeros(res.shape[:-1] + (self.dim,), dtype=np.float64)
        for i, p in enumerate(self.primes):
            r = res[..., i] % p
            ca, sa = _phase(r, p)
            zero = (r == 0)
            d = self.dlog[i][np.where(zero, 1, r)]
            cm, sm = _phase(d, p - 1)
            cm = np.where(zero, 1.0, cm)
            sm = np.where(zero, 0.0, sm)
            o = i * SLOTS_PER_PRIME
            out[..., o + 0] = ca
            out[..., o + 1] = sa
            out[..., o + 2] = cm
            out[..., o + 3] = sm
            out[..., o + 4] = zero.astype(np.float64)
        return out

    def encode(self, n) -> np.ndarray:
        """int or (B,) ints -> (dim,) or (B, dim) math block."""
        arr = np.asarray(n, dtype=np.int64)
        scalar = arr.ndim == 0
        blocks = self.from_residues(self.residues(np.atleast_1d(arr)))
        return blocks[0] if scalar else blocks

    # ------------------------------------------------------------------ #
    # decoding
    # ------------------------------------------------------------------ #
    def decode_residues(self, vec: np.ndarray, channel: str = "add"):
        """Read residues off a (possibly noisy) block.

        channel="add" reads the additive phases; channel="mul" reads the
        multiplicative phases (plus the zero flag).  Returns (residues, err)
        where err is the per-prime angular distance to the nearest lattice
        point, in units of one lattice step (0 = perfect, 0.5 = ambiguous).
        """
        vec = np.atleast_2d(np.asarray(vec, dtype=np.float64))
        res = np.zeros(vec.shape[:-1] + (self.k,), dtype=np.int64)
        err = np.zeros(vec.shape[:-1] + (self.k,), dtype=np.float64)
        for i, p in enumerate(self.primes):
            o = i * SLOTS_PER_PRIME
            if channel == "ml":
                # maximum likelihood under iid Gaussian noise: nearest of the
                # p legal slot patterns, using both phases and the zero flag.
                seg = vec[..., o:o + SLOTS_PER_PRIME]
                d2 = ((seg[..., None, :] - self.codewords[i][None, ...]) ** 2).sum(-1)
                order = np.argsort(d2, axis=-1)
                r = order[..., 0]
                best = np.take_along_axis(d2, order[..., :1], -1)[..., 0]
                second = np.take_along_axis(d2, order[..., 1:2], -1)[..., 0]
                e = 1.0 / (1.0 + np.maximum(second - best, 0.0))   # 0 = confident
            elif channel == "add":
                r, e = _unphase(vec[..., o + 0], vec[..., o + 1], p)
            else:
                d, e = _unphase(vec[..., o + 2], vec[..., o + 3], p - 1)
                is_zero = vec[..., o + 4] > 0.5
                r = np.where(is_zero, 0, self.exp[i][d % (p - 1)])
            res[..., i] = r
            err[..., i] = e
        return res, err

    def crt(self, res: np.ndarray) -> np.ndarray:
        """(B, k) residues -> (B,) integer in [0, M)."""
        res = np.asarray(res, dtype=np.int64)
        acc = np.zeros(res.shape[:-1], dtype=object)
        for i, c in enumerate(self.crt_coeff):
            acc = acc + res[..., i].astype(object) * c
        return np.array([int(x) % self.M for x in np.atleast_1d(acc).ravel()],
                        dtype=np.int64).reshape(res.shape[:-1])

    def decode(self, vec: np.ndarray, channel: str = "add", signed: bool = False):
        """Block -> integer(s).  With signed=True, values above M/2 read as negative."""
        was_1d = np.asarray(vec).ndim == 1
        res, err = self.decode_residues(vec, channel=channel)
        n = self.crt(res)
        if signed:
            n = np.where(n > self.M // 2, n - self.M, n)
        conf = err.max(axis=-1)
        if was_1d:
            return int(n[0]), float(conf[0])
        return n, conf

    # ------------------------------------------------------------------ #
    # the algebra
    # ------------------------------------------------------------------ #
    @staticmethod
    def _cmul(ac, as_, bc, bs):
        return ac * bc - as_ * bs, ac * bs + as_ * bc

    def add_raw(self, u: np.ndarray, v: np.ndarray) -> np.ndarray:
        """Pure bilinear step: elementwise complex product of the ADD channels.

        No lookup, no nonlinearity, no parameters.  The additive channels of
        the result are already exactly those of u+v.  The multiplicative
        channels are left stale -- call canonicalize() to refresh them.
        """
        u = np.atleast_2d(u).copy()
        v = np.atleast_2d(v)
        c, s = self._cmul(u[..., self.idx_add_cos], u[..., self.idx_add_sin],
                          v[..., self.idx_add_cos], v[..., self.idx_add_sin])
        u[..., self.idx_add_cos] = c
        u[..., self.idx_add_sin] = s
        return u

    def mul_raw(self, u: np.ndarray, v: np.ndarray) -> np.ndarray:
        """Pure bilinear step: elementwise complex product of the MUL channels
        (plus a probabilistic-OR on the zero flags).  Exact for u*v."""
        u = np.atleast_2d(u).copy()
        v = np.atleast_2d(v)
        c, s = self._cmul(u[..., self.idx_mul_cos], u[..., self.idx_mul_sin],
                          v[..., self.idx_mul_cos], v[..., self.idx_mul_sin])
        zu = u[..., self.idx_zero]
        zv = v[..., self.idx_zero]
        u[..., self.idx_mul_cos] = c
        u[..., self.idx_mul_sin] = s
        u[..., self.idx_zero] = 1.0 - (1.0 - zu) * (1.0 - zv)
        return u

    def canonicalize(self, vec: np.ndarray, channel: str = "add") -> np.ndarray:
        """Fixed, parameter-free refresh: read the residues off `channel` and
        rebuild every channel from them.  This is the ring's 'distributivity
        glue' -- it is what lets one vector serve both operations."""
        res, _ = self.decode_residues(vec, channel=channel)
        return self.from_residues(res)

    @staticmethod
    def _is1d(x) -> bool:
        return np.asarray(x).ndim == 1

    def add(self, u, v):
        flat = self._is1d(u) and self._is1d(v)
        out = self.canonicalize(self.add_raw(u, v), channel="add")
        return out[0] if flat else out

    def mul(self, u, v):
        flat = self._is1d(u) and self._is1d(v)
        out = self.canonicalize(self.mul_raw(u, v), channel="mul")
        return out[0] if flat else out

    def neg(self, u):
        flat = self._is1d(u)
        w = np.atleast_2d(np.asarray(u, dtype=np.float64)).copy()
        w[..., self.idx_add_sin] *= -1.0
        out = self.canonicalize(w, channel="add")
        return out[0] if flat else out

    def sub(self, u, v):
        flat = self._is1d(u) and self._is1d(v)
        out = self.canonicalize(
            self.add_raw(np.atleast_2d(u), np.atleast_2d(self.neg(v))), channel="add")
        return out[0] if flat else out

    def powk(self, u, k: int):
        """Integer power: scale the multiplicative angle by k.  Exact -- 9 ** 2
        falls straight out of a single scalar multiply."""
        flat = self._is1d(u)
        w = np.atleast_2d(np.asarray(u, dtype=np.float64))
        ang = np.arctan2(w[..., self.idx_mul_sin], w[..., self.idx_mul_cos]) * k
        out = w.copy()
        out[..., self.idx_mul_cos] = np.cos(ang)
        out[..., self.idx_mul_sin] = np.sin(ang)
        if k <= 0:
            out[..., self.idx_zero] = 0.0
        out = self.canonicalize(out, channel="mul")
        return out[0] if flat else out

    def inv(self, u):
        """Modular inverse: conjugate the multiplicative phase.  This is what
        makes exact *division*, and therefore rationals, work."""
        return self.powk(u, -1)

    def div(self, u, v):
        return self.mul(u, self.inv(v))

    # ------------------------------------------------------------------ #
    # robust decoding (redundant residue number system)
    # ------------------------------------------------------------------ #
    def _subset_crt(self, res: np.ndarray, keep: tuple[int, ...]) -> np.ndarray:
        """CRT-reconstruct using only the primes in `keep`."""
        cache = getattr(self, "_subset_cache", None)
        if cache is None:
            cache = self._subset_cache = {}
        if keep not in cache:
            mod = 1
            for i in keep:
                mod *= self.primes[i]
            coeff = []
            for i in keep:
                p = self.primes[i]
                m_i = mod // p
                coeff.append(m_i * pow(m_i, -1, p))
            cache[keep] = (mod, coeff)
        mod, coeff = cache[keep]
        acc = np.zeros(res.shape[:-1], dtype=object)
        for c, i in zip(coeff, keep):
            acc = acc + res[..., i].astype(object) * c
        flat = np.array([int(x) % mod for x in np.atleast_1d(acc).ravel()], dtype=np.int64)
        return flat.reshape(res.shape[:-1])

    def payload_modulus(self, redundancy: int = 2) -> int:
        """Range that stays uniquely decodable after discarding `redundancy`
        of the largest primes.  Spending two spare primes buys single-residue
        error correction, which is what makes a noisy model output usable."""
        if redundancy <= 0:
            return self.M
        mod = self.M
        for p in sorted(self.primes)[-redundancy:]:
            mod //= p
        return mod

    def decode_robust(self, vec: np.ndarray, redundancy: int = 2,
                      channel: str = "ml"):
        """Decode with single-residue error correction.

        Reconstructs from the full prime set and from every drop-one subset,
        then keeps whichever candidate is consistent with the most measured
        residues.  One corrupted residue -- the usual failure mode when a
        neural network emits a slightly-off phase -- is repaired rather than
        turned into a wildly wrong integer.
        """
        was_1d = np.asarray(vec).ndim == 1
        res, _ = self.decode_residues(vec, channel=channel)
        n, score = self.reconstruct_residues(res, redundancy)
        if was_1d:
            return int(n[0]), int(score[0])
        return n, score

    def reconstruct_residues(self, res: np.ndarray, redundancy: int = 2):
        """Error-correcting CRT over an already-decoded residue table.

        Split out from decode_robust so a model can predict residues directly
        (one small softmax per prime, 95 logits in total, instead of a
        131k-wide vocabulary head) and still get the correction for free.
        """
        res = np.asarray(res, dtype=np.int64)
        payload = self.payload_modulus(redundancy)
        k = self.k
        # r redundant residues correct floor(r/2) errors, so search every
        # subset obtained by discarding up to that many primes.
        max_drop = max(0, redundancy // 2)
        from itertools import combinations
        subsets = []
        for d in range(max_drop + 1):
            for drop in combinations(range(k), d):
                keep = tuple(j for j in range(k) if j not in drop)
                mod = 1
                for j in keep:
                    mod *= self.primes[j]
                if mod >= payload:
                    subsets.append(keep)

        cands, agrees = [], []
        for keep in subsets:
            n = self._subset_crt(res, keep)
            agree = np.zeros(n.shape, dtype=np.int64)
            for i, p in enumerate(self.primes):
                agree += (n % p == res[..., i]).astype(np.int64)
            agree = np.where(n < payload, agree, -1)   # out-of-payload = invalid
            cands.append(n)
            agrees.append(agree)
        cands = np.stack(cands, axis=-1)
        agrees = np.stack(agrees, axis=-1)
        best = np.argmax(agrees, axis=-1)
        n = np.take_along_axis(cands, best[..., None], axis=-1)[..., 0]
        score = np.take_along_axis(agrees, best[..., None], axis=-1)[..., 0]
        return n, score

    # ------------------------------------------------------------------ #
    # presets and guards
    # ------------------------------------------------------------------ #
    @classmethod
    def for_integers(cls) -> "MathCodec":
        """Small primes: coarse phase lattices, so the most noise-tolerant
        choice.  This is what the neural experiments use."""
        return cls(DEFAULT_PRIMES)

    @classmethod
    def for_rationals(cls) -> "MathCodec":
        """Primes above the denominator range, so ordinary fractions are all
        invertible.  Finer lattices, wider range, less noise headroom."""
        return cls((101, 103, 107, 109, 113, 127))

    def is_invertible(self, n) -> np.ndarray:
        """A value is invertible in this codec iff it is coprime to M, i.e.
        not divisible by any of the primes.  Division outside this set is not
        defined -- and, importantly, it is *detectable* rather than silent."""
        arr = np.atleast_1d(np.asarray(n, dtype=np.int64)) % self.M
        ok = np.ones(arr.shape, dtype=bool)
        for p in self.primes:
            ok &= (arr % p) != 0
        return ok

    def div_checked(self, u, v):
        """Divide, and report whether the quotient is actually well defined.

        Note that verifying by multiplying back does NOT work: if the divisor
        vanishes mod p then that channel has many solutions and the round trip
        succeeds on a wrong quotient.  The block instead carries its own
        invertibility certificate -- the zero flags.  A divisor is invertible
        exactly when every zero flag is off, which is a purely local read.
        """
        q = self.div(u, v)
        zflags = np.atleast_2d(np.asarray(v, dtype=np.float64))[..., self.idx_zero]
        ok = (zflags < 0.5).all(axis=-1)
        return q, (bool(ok[0]) if self._is1d(v) else ok)

    def nonzero_channels(self, n) -> np.ndarray:
        """(B, k) mask of primes where n is not 0 mod p -- i.e. where the
        multiplicative phase is meaningful."""
        arr = np.atleast_1d(np.asarray(n, dtype=np.int64)) % self.M
        return np.stack([(arr % p) != 0 for p in self.primes], axis=-1)

    # ------------------------------------------------------------------ #
    # torch-friendly helpers
    # ------------------------------------------------------------------ #
    def torch_table(self, lo: int, hi: int):
        """Dense (hi-lo, dim) float32 table, for cheap lookup inside a model."""
        return self.encode(np.arange(lo, hi)).astype(np.float32)

    def __repr__(self) -> str:
        return (f"MathCodec(primes={self.primes}, dim={self.dim}, "
                f"range=[0, {self.M}))")
