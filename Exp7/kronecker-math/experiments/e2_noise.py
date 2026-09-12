"""
E2 -- how much noise the math block survives.

A network never emits the numbers you asked for.  This is exactly the
objection raised in the session against cosine-similarity decoding: early in
training everything is far from everything.  So the question that decides
whether this block is usable is not "is it exact?" (E1 says yes) but "how
wrong may the model be before the decode breaks?".

Three decoders are compared under iid Gaussian noise of scale sigma:

  phase-only   read one angle per prime, CRT.  The obvious thing to do.
  ML           nearest legal slot pattern per prime.  Free accuracy: every
               residue is already stored twice (additive phase AND
               multiplicative phase) plus a zero flag, so a 5-dim
               nearest-codeword decode has ~2x the evidence of one angle.
  ML + RRNS    the above, then discard the primes that disagree.  Spending
               spare primes as redundancy buys error correction, at the cost
               of representable range.
"""

from __future__ import annotations

import json
import math
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from ringemb import MathCodec  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
RESULTS.mkdir(exist_ok=True)


def sigma_at(rows, key, target=0.99):
    best = 0.0
    for r in rows:
        if r[key] >= target:
            best = r["sigma"]
        else:
            break
    return best


def main(n: int = 20_000, seed: int = 0):
    codec = MathCodec.for_integers()
    rng = np.random.default_rng(seed)
    sigmas = np.round(np.linspace(0.0, 0.5, 41), 4)
    payload = codec.payload_modulus(2)

    print(f"{codec}")
    print(f"comparison range: [0, {payload:,})   (the robust-2 payload)\n")

    values = rng.integers(0, payload, size=n)
    clean = codec.encode(values)
    true_res = codec.residues(values)

    rows = []
    per_prime = {str(p): [] for p in codec.primes}
    for s in sigmas:
        noisy = clean + rng.normal(0.0, s, size=clean.shape)
        phase_res, _ = codec.decode_residues(noisy, channel="add")
        ml_res, _ = codec.decode_residues(noisy, channel="ml")
        row = {
            "sigma": float(s),
            "phase_only": float((codec.crt(phase_res) == values).mean()),
            "ml": float((codec.crt(ml_res) == values).mean()),
            "ml_rrns": float((codec.decode_robust(noisy, redundancy=2)[0] == values).mean()),
        }
        for i, p in enumerate(codec.primes):
            per_prime[str(p)].append(float((ml_res[:, i] == true_res[:, i]).mean()))
        rows.append(row)
        print(f"  sigma={s:5.3f}   phase-only {row['phase_only']*100:6.2f}%   "
              f"ML {row['ml']*100:6.2f}%   ML+RRNS {row['ml_rrns']*100:6.2f}%")

    thresholds = {k: sigma_at(rows, k) for k in ("phase_only", "ml", "ml_rrns")}
    print("\nlargest sigma still at >=99% exact recovery:")
    for k, v in thresholds.items():
        print(f"  {k:<12s} sigma = {v}")

    # ---- the range / robustness knob ---------------------------------- #
    print("\nspending primes on redundancy instead of range:")
    trade = []
    for red in (0, 2, 4):
        pay = codec.payload_modulus(red)
        vals = rng.integers(0, pay, size=n)
        cl = codec.encode(vals)
        sub = []
        for s in sigmas:
            noisy = cl + rng.normal(0.0, s, size=cl.shape)
            acc = float((codec.decode_robust(noisy, redundancy=red)[0] == vals).mean())
            sub.append({"sigma": float(s), "acc": acc})
        thr = sigma_at(sub, "acc")
        trade.append({"redundancy": red, "payload": int(pay), "sigma_at_99pct": thr,
                      "curve": sub})
        print(f"  redundancy {red}: range [0, {pay:>9,})   corrects "
              f"{red//2} bad residue(s)   sigma@99% = {thr}")

    out = {
        "n": n,
        "primes": list(codec.primes),
        "dim": codec.dim,
        "payload": int(payload),
        "sigmas": sigmas.tolist(),
        "rows": rows,
        "per_prime_residue_accuracy": per_prime,
        "sigma_at_99pct": thresholds,
        "range_vs_robustness": trade,
        "theoretical_phase_limit": {str(p): math.pi / p for p in codec.primes},
    }
    (RESULTS / "e2_noise.json").write_text(json.dumps(out, indent=2))
    print("\nwrote results/e2_noise.json")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 20_000)
