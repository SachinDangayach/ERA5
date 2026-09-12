"""
E4 -- words in the Kronecker slots, mathematics in the appended slots.

E3 fed the model a bare expression.  The assignment asks for something
stronger: keep the existing 32 byte-slots doing their job for alphabets and
words, and append the math dimensions.  So here the input is a *sentence*,
and the model has to do two different things at once:

  * read the words to work out which operation is being asked for
    ("the total of", "the product of", "subtract ... from"), which is the
    Kronecker word block's job, and
  * do the arithmetic on the operands, which is the math block's job.

Both arms see identical sentences and identical word blocks.  The only
difference is whether the appended math dimensions are populated or zeroed.
Numbers at test time are strictly larger than any number seen in training.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

import numpy as np
import torch
import torch.nn as nn

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from ringemb import KroneckerWordBlock, MathCodec  # noqa: E402
from ringemb.model import TinyFormer  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
RESULTS.mkdir(exist_ok=True)

D_WORD = 64
MAX_LEN = 11

# {A} and {B} are operand slots.  Several surface forms per operation, so the
# model cannot shortcut by sentence length or by a single keyword position.
TEMPLATES = {
    "add": [
        "the total of {A} and {B} is",
        "{A} plus {B} equals",
        "add {A} to {B} and you get",
        "the sum of {A} and {B} comes to",
    ],
    "sub": [
        "subtract {B} from {A} to get",
        "{A} minus {B} equals",
        "the difference between {A} and {B} is",
        "take {B} away from {A} and you have",
    ],
    "mul": [
        "the product of {A} and {B} is",
        "{A} times {B} equals",
        "multiply {A} by {B} and you get",
        "{A} lots of {B} makes",
    ],
}

RANGES = {   # (train_lo, train_hi, ood_lo, ood_hi)
    "add": (0, 10_000, 10_000, 40_001),
    "sub": (0, 10_000, 10_000, 40_001),
    "mul": (0, 200, 200, 292),
}

WORDS = sorted({w for tpl in TEMPLATES.values() for t in tpl
                for w in t.split() if w not in ("{A}", "{B}")})
PAD_ID = 0
WORD_BASE = 1
NUM_BASE = WORD_BASE + len(WORDS)
WORD2ID = {w: WORD_BASE + i for i, w in enumerate(WORDS)}


def device():
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def build_feature_table(codec: MathCodec, n_max: int) -> np.ndarray:
    """One frozen table: [pad] + [words] + [every number]. Nothing is trained."""
    kron = KroneckerWordBlock(d_word=D_WORD, window=32, seed=0)
    dim = D_WORD + codec.dim + 2          # word | math | is_number | is_pad
    table = np.zeros((NUM_BASE + n_max, dim), dtype=np.float32)
    table[PAD_ID, -1] = 1.0
    for w, i in WORD2ID.items():
        table[i, :D_WORD] = kron.encode_one(w)
    nums = np.arange(n_max)
    table[NUM_BASE:, :D_WORD] = np.stack([kron.encode_one(str(i)) for i in nums])
    table[NUM_BASE:, D_WORD:D_WORD + codec.dim] = codec.encode(nums)
    table[NUM_BASE:, -2] = 1.0
    return table


def sample(split: str, n: int, rng: np.random.Generator):
    """Left-padded token ids, the answer, and the operation label."""
    ops = list(TEMPLATES)
    op_idx = rng.integers(0, len(ops), size=n)
    seqs = np.full((n, MAX_LEN), PAD_ID, dtype=np.int64)
    ys = np.zeros(n, dtype=np.int64)
    for i in range(n):
        op = ops[op_idx[i]]
        tlo, thi, olo, ohi = RANGES[op]
        lo, hi = (tlo, thi) if split == "train" else (olo, ohi)
        a, b = int(rng.integers(lo, hi)), int(rng.integers(lo, hi))
        if op == "sub" and b > a:
            a, b = b, a                      # keep results non-negative
        y = a + b if op == "add" else (a - b if op == "sub" else a * b)
        tpl = TEMPLATES[op][rng.integers(0, len(TEMPLATES[op]))]
        toks = [NUM_BASE + a if w == "{A}" else
                NUM_BASE + b if w == "{B}" else WORD2ID[w]
                for w in tpl.split()]
        seqs[i, MAX_LEN - len(toks):] = toks   # left pad, answer read at the end
        ys[i] = y
    return seqs, ys, op_idx


def run(arm: str, table: np.ndarray, codec: MathCodec, steps: int, batch: int,
        seed: int, dev, evals, math_slice):
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    feats = torch.from_numpy(table).to(dev)
    if arm == "kron_only":
        feats = feats.clone()
        feats[:, math_slice] = 0.0

    model = TinyFormer(input_mode="features", head_mode="block", in_dim=table.shape[1],
                       seq_len=MAX_LEN, out_dim=codec.dim, d_model=192, nhead=4,
                       nlayers=3).to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=1e-3, total_steps=steps,
                                                pct_start=0.1)
    math_np = table[:, math_slice]
    t0 = time.time()
    model.train()
    for step in range(steps):
        seqs, y, _ = sample("train", batch, rng)
        x = feats[torch.from_numpy(seqs).to(dev)]
        t = torch.from_numpy(math_np[NUM_BASE + y]).to(dev)
        loss = nn.functional.mse_loss(model(x), t)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if step % max(1, steps // 5) == 0 or step == steps - 1:
            print(f"      step {step:>5d}/{steps}  loss {loss.item():.5f}")

    model.eval()
    out = {"arm": arm, "params": model.n_params(), "seconds": round(time.time() - t0, 1)}
    with torch.no_grad():
        for split, (seqs, y, op_idx) in evals.items():
            raw = model(feats[torch.from_numpy(seqs).to(dev)]).float().cpu().numpy()
            pred = codec.decode_robust(raw, redundancy=2)[0]
            ok = pred == y
            out[f"acc_{split}"] = float(ok.mean())
            out[f"rmse_{split}"] = float(np.sqrt(((raw - math_np[NUM_BASE + y]) ** 2).mean()))
            for i, op in enumerate(TEMPLATES):
                out[f"acc_{split}_{op}"] = float(ok[op_idx == i].mean())
            per_op = "  ".join(f"{op} {out[f'acc_{split}_{op}']*100:5.1f}%"
                               for op in TEMPLATES)
            print(f"      {split:<8s} exact {out[f'acc_{split}']*100:6.2f}%   "
                  f"[{per_op}]   RMSE {out[f'rmse_{split}']:.4f}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=8000)
    ap.add_argument("--batch", type=int, default=384)
    ap.add_argument("--eval-n", type=int, default=15_000)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    dev = device()
    codec = MathCodec.for_integers()
    payload = codec.payload_modulus(2)
    table = build_feature_table(codec, payload)
    math_slice = slice(D_WORD, D_WORD + codec.dim)

    rng = np.random.default_rng(4321)
    evals = {"in_dist": sample("train", args.eval_n, rng),
             "ood": sample("ood", args.eval_n, rng)}
    for split, (_, y, _) in evals.items():
        assert y.max() < payload

    print(f"device={dev}   vocab: {len(WORDS)} words + {payload:,} number tokens")
    print(f"feature dim {table.shape[1]} = {D_WORD} Kronecker word + "
          f"{codec.dim} math + 2 flags\n")

    results = []
    for arm in ("kron_only", "kron_math"):
        print(f"  [{arm}]")
        results.append(run(arm, table, codec, args.steps, args.batch, args.seed,
                           dev, evals, math_slice))
        print()

    print(f"{'arm':<12s} {'in-dist':>9s} {'OOD':>9s}")
    print("-" * 32)
    for r in results:
        print(f"{r['arm']:<12s} {r['acc_in_dist']*100:>8.2f}% {r['acc_ood']*100:>8.2f}%")

    out = {"steps": args.steps, "batch": args.batch, "eval_n": args.eval_n,
           "device": str(dev), "payload": int(payload), "words": WORDS,
           "templates": TEMPLATES, "ranges": RANGES, "arms": results}
    (RESULTS / "e4_mixed_lm.json").write_text(json.dumps(out, indent=2))
    print("\nwrote results/e4_mixed_lm.json")


if __name__ == "__main__":
    main()
