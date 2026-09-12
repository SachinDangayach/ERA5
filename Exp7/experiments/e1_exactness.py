"""
E1 -- the algebra is exact, with zero learned parameters.

Millions of random operand pairs are pushed through the codec and the decoded
answer is compared against ground truth.  Nothing here is trained: this is a
property of the encoding, not of a model.

Two honest caveats are measured rather than hidden:
  * arithmetic wraps modulo M (it is a ring Z_M, not the integers),
  * division is defined exactly when the divisor is coprime to M, and when it
    is not, the failure is *detected* by div_checked rather than silent.
"""

from __future__ import annotations

import json
import math
import pathlib
import sys
import time
from fractions import Fraction

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from ringemb import MathCodec, rational_reconstruct  # noqa: E402

RESULTS = pathlib.Path(__file__).resolve().parents[1] / "results"
RESULTS.mkdir(exist_ok=True)
CHECKS: list[dict] = []


def check(name, got, want):
    got = np.asarray(got, dtype=np.int64)
    want = np.asarray(want, dtype=np.int64)
    ok = int((got == want).sum())
    n = int(want.size)
    print(f"  {name:<36s} {ok}/{n}  ({100.0 * ok / n:.4f}%)")
    bad = np.flatnonzero(got != want)[:3]
    if bad.size:
        print(f"      first mismatches got={got[bad].tolist()} want={want[bad].tolist()}")
    rec = {"name": name, "correct": ok, "total": n, "accuracy": ok / n}
    CHECKS.append(rec)
    return rec


def main(n_trials: int = 200_000, seed: int = 0):
    codec = MathCodec.for_integers()
    rng = np.random.default_rng(seed)
    M = codec.M
    out = {"codec": repr(codec), "primes": list(codec.primes), "dim": codec.dim,
           "modulus": M, "n_trials": n_trials}

    print(f"{codec}\n")
    print(f"Math block = {codec.dim} real dimensions, appended after the Kronecker word block.")
    print(f"Represents every integer in [0, {M:,}) exactly.\n")
    t0 = time.time()

    # ------------------------------------------------------------------ #
    print("ADDITION   E(a) (+) E(b)  ==  E(a+b)")
    a = rng.integers(0, M, size=n_trials)
    b = rng.integers(0, M, size=n_trials)
    got, conf = codec.decode(codec.add(codec.encode(a), codec.encode(b)))
    check("random pairs, full range", got, (a + b) % M)
    out["add_worst_margin"] = float(conf.max())

    a_s, b_s = rng.integers(0, 1000, n_trials), rng.integers(0, 1000, n_trials)
    got, _ = codec.decode(codec.add(codec.encode(a_s), codec.encode(b_s)))
    check("random pairs, 0..999", got, a_s + b_s)

    # add_raw is one elementwise complex product: no lookup, no branch, no
    # parameters.  Its ADD channels are already exactly E(a+b)'s ADD channels.
    raw = codec.add_raw(codec.encode(a), codec.encode(b))
    ref = codec.encode((a + b) % M)
    sl = np.concatenate([codec.idx_add_cos, codec.idx_add_sin])
    err = float(np.abs(raw[:, sl] - ref[:, sl]).max())
    print(f"  {'add_raw channel max abs err':<36s} {err:.3e}  (pure bilinear, 0 params)")
    out["add_raw_max_abs_err"] = err

    # ------------------------------------------------------------------ #
    print("\nMULTIPLICATION   E(a) (x) E(b)  ==  E(a*b)")
    a = rng.integers(0, M, size=n_trials)
    b = rng.integers(0, M, size=n_trials)
    got, conf = codec.decode(codec.mul(codec.encode(a), codec.encode(b)))
    check("random pairs, full range", got, (a.astype(object) * b.astype(object)) % M)
    out["mul_worst_margin"] = float(conf.max())

    a_s, b_s = rng.integers(0, 1000, n_trials), rng.integers(0, 1000, n_trials)
    got, _ = codec.decode(codec.mul(codec.encode(a_s), codec.encode(b_s)))
    check("random pairs, 0..999", got, a_s * b_s)

    # zero breaks a discrete log; the zero flag is what repairs it
    b_z = np.where(rng.random(n_trials) < 0.5, 0, rng.integers(0, 1000, n_trials))
    got, _ = codec.decode(codec.mul(codec.encode(a_s), codec.encode(b_z)))
    check("with zero operands", got, a_s * b_z)

    # The raw bilinear identity for MUL holds on the channels where the
    # discrete log is defined, i.e. where neither operand vanishes mod p.
    raw = codec.mul_raw(codec.encode(a_s), codec.encode(b_s))
    ref = codec.encode(a_s * b_s)
    live = codec.nonzero_channels(a_s) & codec.nonzero_channels(b_s)
    d = np.abs(raw[:, codec.idx_mul_cos] - ref[:, codec.idx_mul_cos])
    d = np.maximum(d, np.abs(raw[:, codec.idx_mul_sin] - ref[:, codec.idx_mul_sin]))
    err = float(d[live].max())
    print(f"  {'mul_raw channel max abs err':<36s} {err:.3e}  (pure bilinear, 0 params,")
    print(f"  {'':<36s}            over the {100*live.mean():.1f}% of channels where dlog is defined)")
    out["mul_raw_max_abs_err_live"] = err

    # ------------------------------------------------------------------ #
    print("\nOTHER OPERATIONS")
    a_s = rng.integers(0, 100_000, n_trials)
    b_s = rng.integers(0, 100_000, n_trials)
    got, _ = codec.decode(codec.sub(codec.encode(a_s), codec.encode(b_s)), signed=True)
    check("subtraction (signed)", got, a_s.astype(np.int64) - b_s)

    base = rng.integers(1, 60, n_trials)
    for k in (2, 3, 4):
        got, _ = codec.decode(codec.powk(codec.encode(base), k))
        check(f"integer power  a ** {k}", got, [pow(int(x), k, M) for x in base])

    # Division needs an invertible divisor: gcd(q, M) == 1.
    q_all = rng.integers(1, 5000, n_trials)
    inv_mask = codec.is_invertible(q_all)
    q = q_all[inv_mask]
    prod = rng.integers(1, 5000, q.size) * q
    got, _ = codec.decode(codec.div(codec.encode(prod), codec.encode(q)))
    check("exact division, invertible divisor", got, prod // q)
    frac = float(inv_mask.mean())
    print(f"  {'divisors coprime to M':<36s} {100*frac:.1f}% of 1..4999")
    out["invertible_divisor_fraction"] = frac

    # ...and when the divisor is NOT invertible, we detect it instead of lying.
    bad_q = q_all[~inv_mask][:20_000]
    _, ok = codec.div_checked(codec.encode(rng.integers(1, 5000, bad_q.size) * bad_q),
                              codec.encode(bad_q))
    print(f"  {'non-invertible divisor detected':<36s} "
          f"{int((~ok).sum())}/{ok.size} flagged (zero-flag certificate)")
    out["noninvertible_detected"] = float((~ok).mean())

    # ------------------------------------------------------------------ #
    print("\nCOMPOSITION   ((a + b) * c) - d")
    a = rng.integers(0, 5000, n_trials)
    b = rng.integers(0, 5000, n_trials)
    c = rng.integers(0, 200, n_trials)
    d = rng.integers(0, 5000, n_trials)
    v = codec.sub(codec.mul(codec.add(codec.encode(a), codec.encode(b)),
                            codec.encode(c)), codec.encode(d))
    got, _ = codec.decode(v, signed=True)
    check("4-step expression", got, (a.astype(np.int64) + b) * c - d)

    # ------------------------------------------------------------------ #
    # The homomorphism itself: operating on the embeddings must produce the
    # embedding of the result, not merely something that decodes alike.
    #
    #        (a, b)  --- a op b --->   y
    #           |                      |
    #        encode                 encode
    #           v                      v
    #     (E(a), E(b)) --- (x) --->  E(a) (x) E(b)   ==   E(y)
    #
    print("\nROUND TRIP   op(E(a), E(b))  vs  E(a op b), slot by slot")
    rt = {}
    for name, vec_op, int_op, filt in (
        ("a + b", codec.add, lambda x, y: (x + y) % M, None),
        ("a - b", codec.sub, lambda x, y: (x - y) % M, None),
        ("a * b", codec.mul,
         lambda x, y: np.array([(int(u) * int(v)) % M for u, v in zip(x, y)]), None),
        ("a / b", codec.div,
         lambda x, y: np.array([(int(u) * pow(int(v), -1, M)) % M for u, v in zip(x, y)]),
         "invertible"),
    ):
        x = rng.integers(0, M, size=n_trials)
        yv = rng.integers(1, M, size=n_trials)
        if filt == "invertible":
            keep = codec.is_invertible(yv)
            x, yv = x[keep], yv[keep]
        got = vec_op(codec.encode(x), codec.encode(yv))
        ref = codec.encode(int_op(x, yv))
        d = float(np.abs(got - ref).max())
        ident = int((np.abs(got - ref) < 1e-12).all(axis=-1).sum())
        rt[name] = {"pairs": int(x.size), "max_slot_diff": d, "identical": ident}
        print(f"  {name:<8s} {ident}/{x.size} blocks identical   "
              f"max slot difference {d:.3e}")
        CHECKS.append({"name": f"round trip {name}", "correct": ident,
                       "total": int(x.size), "accuracy": ident / x.size})
    out["round_trip"] = rt

    # ------------------------------------------------------------------ #
    # Rationals: each prime channel is a FIELD, so the same block is closed
    # under division.  Use primes above the denominator range.
    print("\nRATIONALS   the same block is closed under division")
    rc = MathCodec.for_rationals()
    bound = math.isqrt(rc.M // 2)
    print(f"  {rc}")
    print(f"  reconstruction bound  |a|, b <= {bound:,}")
    rng2 = np.random.default_rng(seed + 1)
    trials, ok, shown = 20_000, 0, []
    dens = np.arange(1, 301)
    coverage = float(rc.is_invertible(dens).mean())
    for _ in range(trials):
        while True:
            q1 = int(rng2.integers(1, 301))
            if rc.is_invertible(q1)[0]:
                break
        while True:
            q2 = int(rng2.integers(1, 301))
            if rc.is_invertible(q2)[0]:
                break
        p1, p2 = int(rng2.integers(-300, 301)), int(rng2.integers(-300, 301))
        f1, f2 = Fraction(p1, q1), Fraction(p2, q2)
        u = rc.div(rc.encode(p1 % rc.M), rc.encode(q1))
        v = rc.div(rc.encode(p2 % rc.M), rc.encode(q2))
        gs = rational_reconstruct(int(rc.decode(rc.add(u, v))[0]), rc.M, bound)
        gm = rational_reconstruct(int(rc.decode(rc.mul(u, v))[0]), rc.M, bound)
        if gs == f1 + f2 and gm == f1 * f2:
            ok += 1
        elif len(shown) < 3:
            shown.append(f"      MISS {f1} + {f2} -> {gs} (want {f1+f2})")
        if len(shown) < 3 and ok <= 3:
            shown.append(f"      {f1} + {f2} = {gs}   |   {f1} * {f2} = {gm}")
    print(f"  {'rational + and * recovered':<36s} {ok}/{trials}  ({100.0*ok/trials:.4f}%)")
    for line in shown:
        print(line)
    print(f"  {'denominators 1..300 supported':<36s} {100*coverage:.1f}% "
          f"(rest share a factor with M; add a prime to cover them)")
    CHECKS.append({"name": "rational arithmetic", "correct": ok, "total": trials,
                   "accuracy": ok / trials})
    out["rational_denominator_coverage"] = coverage

    # ------------------------------------------------------------------ #
    out["checks"] = CHECKS
    out["seconds"] = round(time.time() - t0, 2)
    total = sum(c["total"] for c in CHECKS)
    correct = sum(c["correct"] for c in CHECKS)
    out["overall_accuracy"] = correct / total
    print(f"\nOVERALL  {correct:,}/{total:,} = {100.0*correct/total:.6f}%   ({out['seconds']}s)")
    (RESULTS / "e1_exactness.json").write_text(json.dumps(out, indent=2))
    print(f"wrote results/e1_exactness.json")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 200_000)
