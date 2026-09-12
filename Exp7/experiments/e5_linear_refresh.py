"""
E5 -- the glue really can be linear.

codec.py refreshes one channel from the other with a small fixed lookup.  That
is parameter-free but nonlinear, so this experiment checks the stronger claim:
with the full character basis, every step of the construction is either an
elementwise complex product or a FIXED MATRIX MULTIPLY, and the result is still
exact.  The cost is dimension, which is measured here too.
"""

from __future__ import annotations

import json
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from ringemb import MathCodec  # noqa: E402
from ringemb.linear_refresh import LinearRefreshCodec  # noqa: E402

RESULTS = pathlib.Path(__file__).resolve().parents[1] / "results"
RESULTS.mkdir(exist_ok=True)


def main(n: int = 20_000, seed: int = 0):
    lc = LinearRefreshCodec()
    compact = MathCodec.for_integers()
    rng = np.random.default_rng(seed)
    M = lc.M
    out = {"primes": list(lc.primes), "dim_linear": lc.dim,
           "dim_compact": compact.dim, "modulus": M, "n": n}

    print(f"primes {lc.primes}")
    print(f"compact codec (lookup refresh):  {compact.dim} dims")
    print(f"linear codec  (matrix refresh):  {lc.dim} dims"
          f"   ({lc.dim / compact.dim:.1f}x the cost)\n")

    a = rng.integers(0, M, size=n)
    b = rng.integers(0, M, size=n)
    ea, eb = lc.encode(a), lc.encode(b)

    got = lc.decode(lc.add(ea, eb))
    acc_add = float((got == (a + b) % M).mean())
    err_add = float(np.abs(lc.add(ea, eb) - lc.encode((a + b) % M)).max())
    print(f"  addition        {int(acc_add*n)}/{n} exact   "
          f"max abs deviation from E(a+b): {err_add:.3e}")

    want_mul = np.array([(int(x) * int(y)) % M for x, y in zip(a, b)])
    got = lc.decode(lc.mul(ea, eb))
    acc_mul = float((got == want_mul).mean())
    err_mul = float(np.abs(lc.mul(ea, eb) - lc.encode(want_mul)).max())
    print(f"  multiplication  {int(acc_mul*n)}/{n} exact   "
          f"max abs deviation from E(a*b): {err_mul:.3e}")

    # zero is the interesting case for the multiplicative side
    bz = np.where(rng.random(n) < 0.5, 0, rng.integers(0, 5000, n))
    az = rng.integers(0, 5000, n)
    acc_zero = float((lc.decode(lc.mul(lc.encode(az), lc.encode(bz))) == az * bz).mean())
    print(f"  with zeros      {int(acc_zero*n)}/{n} exact")

    # ---- and the refreshes really are linear -------------------------- #
    print("\n  linearity of the refresh maps  f(alpha x + beta y) == alpha f(x) + beta f(y)")
    lin = {}
    for name, f in (("refresh_from_add", lc.refresh_from_add),
                    ("refresh_from_mul", lc.refresh_from_mul)):
        x = rng.normal(size=(400, lc.dim))
        y = rng.normal(size=(400, lc.dim))
        al, be = 0.37, -1.9
        left = f(al * x + be * y)
        right = al * f(x) + be * f(y)
        e = float(np.abs(left - right).max())
        lin[name] = e
        print(f"    {name:<20s} max abs violation {e:.3e}")

    out.update({"acc_add": acc_add, "acc_mul": acc_mul, "acc_mul_with_zeros": acc_zero,
                "max_abs_err_add": err_add, "max_abs_err_mul": err_mul,
                "linearity_violation": lin})
    ok = (min(acc_add, acc_mul, acc_zero) == 1.0
          and max(lin.values()) < 1e-9)
    out["all_passed"] = bool(ok)
    print(f"\n  every step is an elementwise complex product or a fixed matrix: "
          f"{'CONFIRMED' if ok else 'FAILED'}")
    (RESULTS / "e5_linear_refresh.json").write_text(json.dumps(out, indent=2))
    print("wrote results/e5_linear_refresh.json")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 20_000)
