"""
ringemb.data -- arithmetic problems, and the two ways of presenting them.

The point of the comparison is that "473" is a *single token* for the
Kronecker path (its embedding is computed from its bytes, so a number never
seen in training is still representable), while the digit baseline has to
spell it out and infer magnitude from position.
"""

from __future__ import annotations

import numpy as np

DIGITS = "0123456789"
SYMBOLS = DIGITS + "+*= "        # trailing space is the pad symbol
SYM2ID = {c: i for i, c in enumerate(SYMBOLS)}
PAD = SYM2ID[" "]

TASKS = {
    #             train lo/hi        ood lo/hi
    "add": {"op": "+", "train": (0, 10_000), "ood": (10_000, 40_001)},
    "mul": {"op": "*", "train": (0, 200), "ood": (200, 292)},
}


def sample(task: str, split: str, n: int, rng: np.random.Generator):
    cfg = TASKS[task]
    lo, hi = cfg["train"] if split == "train" else cfg["ood"]
    a = rng.integers(lo, hi, size=n)
    b = rng.integers(lo, hi, size=n)
    y = a + b if cfg["op"] == "+" else a * b
    return a, b, y


def digit_batch(a, b, op: str, n_digits: int = 6):
    """Left-padded digit spelling: '00473' '+' '00089' '=' -> ids."""
    n = len(a)
    seq = np.full((n, 2 * n_digits + 2), PAD, dtype=np.int64)
    for j, arr in enumerate((a, b)):
        s = [str(int(v)).rjust(n_digits, "0") for v in arr]
        block = np.array([[SYM2ID[c] for c in t] for t in s], dtype=np.int64)
        seq[:, j * (n_digits + 1): j * (n_digits + 1) + n_digits] = block
    seq[:, n_digits] = SYM2ID[op]
    seq[:, -1] = SYM2ID["="]
    return seq


def digit_targets(y, n_digits: int = 6):
    s = [str(int(v)).rjust(n_digits, "0") for v in y]
    return np.array([[int(c) for c in t] for t in s], dtype=np.int64)


def digits_to_int(pred):
    """(B, n_digits) predicted digit classes -> integers."""
    out = np.zeros(pred.shape[0], dtype=np.int64)
    for j in range(pred.shape[1]):
        out = out * 10 + pred[:, j]
    return out
