"""
ringemb.linear_refresh -- paying dimensions to make the glue linear.

The compact codec in codec.py refreshes one channel from the other with a
lookup (`canonicalize`).  That is fixed and parameter-free, but it is not
linear, and a reviewer is entitled to ask whether the whole construction can
be done with nothing but (i) an elementwise complex product and (ii) a fixed
matrix.  It can, and this module is the proof.

The trick is to stop storing one harmonic per prime and store the *whole*
character basis instead:

    additive        A_k(r) = exp(2 pi i k r / p),            k = 0..p-1
    multiplicative  X_j(r) = exp(2 pi i j dlog(r) / (p-1)),  j = 0..p-2
                    (and X(0) := 0, flagged by z)

A is the DFT of the indicator delta_r over Z_p, and X is the DFT of the
indicator of dlog(r) over Z_{p-1}.  Both are unitary changes of basis on the
*same* underlying object -- the indicator vector -- so converting between them
is a fixed matrix:

    add -> mul :   delta = Finv @ A ;  z = delta[0] ;  X = G @ Q @ delta
    mul -> add :   delta = [ z ; Qt @ Ginv @ X ] ;     A = F @ delta

Both directions are linear.  Composition then reads:

    a + b :  Hadamard product on A, then the (linear) add->mul refresh
    a * b :  Hadamard product on X and z <- z_a + z_b - z_a z_b (bilinear),
             then the (linear) mul->add refresh

The price is dimension: 4p-1 reals per prime instead of 5, so 373 instead of
35 for the default prime set.  The compact codec is what you would ship; this
is what you would cite.
"""

from __future__ import annotations

import numpy as np

from .codec import DEFAULT_PRIMES, MathCodec


class LinearRefreshCodec:
    """Full-character variant, where both refreshes are matrix multiplies."""

    def __init__(self, primes=DEFAULT_PRIMES):
        self.base = MathCodec(primes)
        self.primes = self.base.primes
        self.k = self.base.k
        self.M = self.base.M
        self.sizes = [4 * p - 1 for p in self.primes]
        self.offsets = np.cumsum([0] + self.sizes)
        self.dim = int(self.offsets[-1])

        self.F, self.Finv, self.G, self.Ginv, self.Q = [], [], [], [], []
        for i, p in enumerate(self.primes):
            r = np.arange(p)
            F = np.exp(2j * np.pi * np.outer(r, r) / p)          # (p, p)
            d = np.arange(p - 1)
            G = np.exp(2j * np.pi * np.outer(d, d) / (p - 1))    # (p-1, p-1)
            Q = np.zeros((p - 1, p))                             # r -> dlog(r)
            for rr in range(1, p):
                Q[self.base.dlog[i][rr], rr] = 1.0
            self.F.append(F)
            self.Finv.append(np.conj(F) / p)
            self.G.append(G)
            self.Ginv.append(np.conj(G) / (p - 1))
            self.Q.append(Q)

    # ---------------- packing ------------------------------------------ #
    def _pack(self, A, X, z, i, out, sl):
        p = self.primes[i]
        out[..., sl.start:sl.start + p] = A.real
        out[..., sl.start + p:sl.start + 2 * p] = A.imag
        out[..., sl.start + 2 * p:sl.start + 3 * p - 1] = X.real
        out[..., sl.start + 3 * p - 1:sl.start + 4 * p - 2] = X.imag
        out[..., sl.start + 4 * p - 2] = z

    def _unpack(self, vec, i):
        p = self.primes[i]
        o = int(self.offsets[i])
        A = vec[..., o:o + p] + 1j * vec[..., o + p:o + 2 * p]
        X = (vec[..., o + 2 * p:o + 3 * p - 1]
             + 1j * vec[..., o + 3 * p - 1:o + 4 * p - 2])
        z = vec[..., o + 4 * p - 2]
        return A, X, z

    # ---------------- encode / decode ----------------------------------- #
    def encode(self, n) -> np.ndarray:
        arr = np.atleast_1d(np.asarray(n, dtype=np.int64)) % self.M
        out = np.zeros(arr.shape + (self.dim,), dtype=np.float64)
        for i, p in enumerate(self.primes):
            r = arr % p
            delta = np.zeros(arr.shape + (p,))
            np.put_along_axis(delta, r[..., None], 1.0, axis=-1)
            A = delta.astype(complex) @ self.F[i].T
            X = (delta @ self.Q[i].T).astype(complex) @ self.G[i].T
            self._pack(A, X, (r == 0).astype(float), i, out,
                       slice(int(self.offsets[i]), int(self.offsets[i + 1])))
        return out[0] if np.asarray(n).ndim == 0 else out

    def decode(self, vec) -> np.ndarray:
        vec = np.atleast_2d(vec)
        res = np.zeros(vec.shape[:-1] + (self.k,), dtype=np.int64)
        for i, p in enumerate(self.primes):
            A, _, _ = self._unpack(vec, i)
            delta = (A @ self.Finv[i].T).real
            res[..., i] = np.argmax(delta, axis=-1)
        return self.base.crt(res)

    # ---------------- the two linear refreshes -------------------------- #
    def refresh_from_add(self, vec):
        """A -> (delta) -> (z, X).  One matrix multiply per prime."""
        vec = np.atleast_2d(np.asarray(vec, dtype=np.float64))
        out = vec.copy()
        for i, p in enumerate(self.primes):
            A, _, _ = self._unpack(vec, i)
            delta = A @ self.Finv[i].T
            X = delta @ (self.G[i] @ self.Q[i]).T
            self._pack(A, X, delta[..., 0].real, i, out,
                       slice(int(self.offsets[i]), int(self.offsets[i + 1])))
        return out

    def refresh_from_mul(self, vec):
        """(z, X) -> (delta) -> A.  One matrix multiply per prime."""
        vec = np.atleast_2d(np.asarray(vec, dtype=np.float64))
        out = vec.copy()
        for i, p in enumerate(self.primes):
            _, X, z = self._unpack(vec, i)
            delta = X @ (self.Ginv[i].T @ self.Q[i])
            delta = delta + z[..., None] * np.eye(p)[0]
            A = delta @ self.F[i].T
            self._pack(A, X, z, i, out,
                       slice(int(self.offsets[i]), int(self.offsets[i + 1])))
        return out

    # ---------------- the two compositions ------------------------------ #
    def add(self, u, v):
        flat = np.asarray(u).ndim == 1
        u2, v2 = np.atleast_2d(u), np.atleast_2d(v)
        out = u2.copy()
        for i, p in enumerate(self.primes):
            Au, _, _ = self._unpack(u2, i)
            Av, _, _ = self._unpack(v2, i)
            o = int(self.offsets[i])
            A = Au * Av                                   # elementwise complex product
            out[..., o:o + p] = A.real
            out[..., o + p:o + 2 * p] = A.imag
        out = self.refresh_from_add(out)                  # fixed linear map
        return out[0] if flat else out

    def mul(self, u, v):
        flat = np.asarray(u).ndim == 1
        u2, v2 = np.atleast_2d(u), np.atleast_2d(v)
        out = u2.copy()
        for i, p in enumerate(self.primes):
            _, Xu, zu = self._unpack(u2, i)
            _, Xv, zv = self._unpack(v2, i)
            o = int(self.offsets[i])
            X = Xu * Xv                                   # elementwise complex product
            out[..., o + 2 * p:o + 3 * p - 1] = X.real
            out[..., o + 3 * p - 1:o + 4 * p - 2] = X.imag
            out[..., o + 4 * p - 2] = zu + zv - zu * zv   # bilinear
        out = self.refresh_from_mul(out)                  # fixed linear map
        return out[0] if flat else out
