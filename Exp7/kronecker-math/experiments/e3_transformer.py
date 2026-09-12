"""
E3 -- does a transformer actually benefit from the math block?

Five arms share one backbone (2 layers, 4 heads, d_model 128) so that any
difference comes from the embedding and the head, not from capacity.

  A  digit-baseline      learned symbol embeddings, six 10-way digit softmaxes.
                         This is how an ordinary LM does arithmetic.
  B  kron -> block       Kronecker word block only (spelling, no math),
                         regressing the 35-dim math block of the answer.
  C  kron+math -> block  the proposal: math block appended to the input, math
                         block regressed at the output.
  D  kron+math -> resid  same input, but the head is one small softmax per
                         prime -- 95 logits replacing a whole vocabulary head.
  F  kron+math -> digits math block on the input, ordinary digit head, to
                         separate "structure in the input" from "structure in
                         the output".

Every arm trains on the same problems and is scored on held-out problems from
the training range (in-distribution) and on operands strictly larger than
anything seen during training (out-of-distribution).  The whole point of
putting structure in the embedding is that the OOD column should not collapse.
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
from ringemb import MathCodec, KroneckerWordBlock  # noqa: E402
from ringemb.data import (SYMBOLS, TASKS, digit_batch, digit_targets,  # noqa: E402
                          digits_to_int, sample)
from ringemb.model import TinyFormer  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
RESULTS.mkdir(exist_ok=True)

D_WORD = 64
N_DIGITS = 6
ARMS = ["A_digit_baseline", "B_kron_only__block", "C_kron_math__block",
        "D_kron_math__residue", "F_kron_math__digits"]


def device():
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


class Tables:
    """Precomputed, frozen lookup tables. Nothing here is ever trained."""

    def __init__(self, codec: MathCodec, n_max: int):
        kron = KroneckerWordBlock(d_word=D_WORD, window=32, seed=0)
        self.kron_num = np.stack([kron.encode_one(str(i)) for i in range(n_max)])
        self.math_num = codec.encode(np.arange(n_max))
        self.kron_sym = {s: kron.encode_one(s) for s in ("+", "*", "=")}
        self.codec = codec
        self.d_word = D_WORD
        self.feat_dim = D_WORD + codec.dim + 1     # word | math | is-number

    def features(self, a, b, op: str, use_math: bool) -> np.ndarray:
        n = len(a)
        f = np.zeros((n, 4, self.feat_dim), dtype=np.float32)
        for pos, arr in ((0, a), (2, b)):
            f[:, pos, :self.d_word] = self.kron_num[arr]
            if use_math:
                f[:, pos, self.d_word:self.d_word + self.codec.dim] = self.math_num[arr]
            f[:, pos, -1] = 1.0
        f[:, 1, :self.d_word] = self.kron_sym[op]
        f[:, 3, :self.d_word] = self.kron_sym["="]
        return f


def build(arm: str, codec: MathCodec, tables: Tables,
          d_model: int = 128, nlayers: int = 2) -> TinyFormer:
    common = dict(d_model=d_model, nhead=4, nlayers=nlayers)
    if arm == "A_digit_baseline":
        return TinyFormer(input_mode="vocab", head_mode="digits", vocab=len(SYMBOLS),
                          seq_len=2 * N_DIGITS + 2, n_digits=N_DIGITS, **common)
    if arm == "B_kron_only__block":
        return TinyFormer(input_mode="features", head_mode="block", in_dim=tables.feat_dim,
                          seq_len=4, out_dim=codec.dim, **common)
    if arm == "C_kron_math__block":
        return TinyFormer(input_mode="features", head_mode="block", in_dim=tables.feat_dim,
                          seq_len=4, out_dim=codec.dim, **common)
    if arm == "D_kron_math__residue":
        return TinyFormer(input_mode="features", head_mode="residue", in_dim=tables.feat_dim,
                          seq_len=4, primes=codec.primes, **common)
    return TinyFormer(input_mode="features", head_mode="digits", in_dim=tables.feat_dim,
                      seq_len=4, n_digits=N_DIGITS, **common)


def make_inputs(arm, a, b, op, tables):
    if arm == "A_digit_baseline":
        return torch.from_numpy(digit_batch(a, b, op, N_DIGITS))
    use_math = arm != "B_kron_only__block"
    return torch.from_numpy(tables.features(a, b, op, use_math))


def make_targets(arm, y, codec, tables):
    if arm.endswith("digits") or arm == "A_digit_baseline":
        return torch.from_numpy(digit_targets(y, N_DIGITS))
    if arm.endswith("residue"):
        return torch.from_numpy(codec.residues(y))
    return torch.from_numpy(tables.math_num[y].astype(np.float32))


def loss_fn(arm, out, tgt, codec):
    if arm.endswith("digits") or arm == "A_digit_baseline":
        return nn.functional.cross_entropy(
            out.view(-1, N_DIGITS, 10).reshape(-1, 10), tgt.reshape(-1))
    if arm.endswith("residue"):
        total, off = 0.0, 0
        for i, p in enumerate(codec.primes):
            total = total + nn.functional.cross_entropy(out[:, off:off + p], tgt[:, i])
            off += p
        return total / len(codec.primes)
    return nn.functional.mse_loss(out, tgt)


@torch.no_grad()
def predict(arm, model, a, b, op, tables, codec, dev):
    x = make_inputs(arm, a, b, op, tables).to(dev)
    out = model(x).float().cpu().numpy()
    if arm.endswith("digits") or arm == "A_digit_baseline":
        return digits_to_int(out.reshape(-1, N_DIGITS, 10).argmax(-1)), None
    if arm.endswith("residue"):
        res, off = [], 0
        for p in codec.primes:
            res.append(out[:, off:off + p].argmax(-1))
            off += p
        return codec.reconstruct_residues(np.stack(res, -1), redundancy=2)[0], None
    tgt = None
    return codec.decode_robust(out, redundancy=2)[0], out


def run_arm(arm, task, codec, tables, steps, batch, seed, dev, evals,
            d_model=128, nlayers=2, lr=1e-3):
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    op = TASKS[task]["op"]
    model = build(arm, codec, tables, d_model, nlayers).to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=steps,
                                                pct_start=0.1)
    t0 = time.time()
    model.train()
    for step in range(steps):
        a, b, y = sample(task, "train", batch, rng)
        x = make_inputs(arm, a, b, op, tables).to(dev)
        t = make_targets(arm, y, codec, tables).to(dev)
        loss = loss_fn(arm, model(x), t, codec)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if step % max(1, steps // 5) == 0 or step == steps - 1:
            print(f"      step {step:>5d}/{steps}  loss {loss.item():.5f}")

    model.eval()
    out = {"arm": arm, "params": model.n_params(), "seconds": round(time.time() - t0, 1),
           "final_loss": float(loss.item())}
    for split, (a, b, y) in evals.items():
        pred, raw = predict(arm, model, a, b, op, tables, codec, dev)
        acc = float((pred == y).mean())
        out[f"acc_{split}"] = acc
        if raw is not None:
            resid = float(np.sqrt(((raw - tables.math_num[y]) ** 2).mean()))
            out[f"block_rmse_{split}"] = resid
        print(f"      {split:<8s} exact-match {acc*100:6.2f}%"
              + (f"   block RMSE {resid:.4f}" if raw is not None else ""))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", default="add", choices=list(TASKS))
    ap.add_argument("--steps", type=int, default=4000)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--eval-n", type=int, default=20_000)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--arms", default=",".join(ARMS))
    ap.add_argument("--d-model", type=int, default=128)
    ap.add_argument("--nlayers", type=int, default=2)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--tag", default="")
    args = ap.parse_args()

    dev = device()
    codec = MathCodec.for_integers()
    payload = codec.payload_modulus(2)
    tables = Tables(codec, payload)
    cfg = TASKS[args.task]

    rng = np.random.default_rng(1234)
    evals = {"in_dist": sample(args.task, "train", args.eval_n, rng),
             "ood": sample(args.task, "ood", args.eval_n, rng)}
    for split, (_, _, y) in evals.items():
        assert y.max() < payload, f"{split} results exceed payload {payload}"

    print(f"task={args.task}  op='{cfg['op']}'  device={dev}")
    print(f"train operands {cfg['train']}   OOD operands {cfg['ood']}")
    print(f"codec {codec}  payload {payload:,}\n")

    results = []
    for arm in args.arms.split(","):
        print(f"  [{arm}]")
        results.append(run_arm(arm, args.task, codec, tables, args.steps,
                               args.batch, args.seed, dev, evals,
                               args.d_model, args.nlayers, args.lr))
        print()

    # zero-shot reference: the closed-form operator needs no model at all
    a, b, y = evals["ood"]
    zs = codec.decode_robust(
        codec.add(codec.encode(a), codec.encode(b)) if cfg["op"] == "+"
        else codec.mul(codec.encode(a), codec.encode(b)), redundancy=2)[0]
    zero_shot = float((zs == y).mean())

    print(f"{'arm':<24s} {'params':>8s} {'in-dist':>9s} {'OOD':>9s}")
    print("-" * 54)
    for r in results:
        print(f"{r['arm']:<24s} {r['params']:>8,} {r['acc_in_dist']*100:>8.2f}% "
              f"{r['acc_ood']*100:>8.2f}%")
    print(f"{'(closed form, 0 params)':<24s} {0:>8} {'100.00%':>9s} "
          f"{zero_shot*100:>8.2f}%")

    out = {"task": args.task, "op": cfg["op"], "train_range": cfg["train"],
           "ood_range": cfg["ood"], "steps": args.steps, "batch": args.batch,
           "eval_n": args.eval_n, "device": str(dev), "payload": int(payload),
           "zero_shot_ood": zero_shot, "arms": results}
    out["d_model"], out["nlayers"] = args.d_model, args.nlayers
    path = RESULTS / f"e3_{args.task}{args.tag}.json"
    path.write_text(json.dumps(out, indent=2))
    print(f"\nwrote results/{path.name}")


if __name__ == "__main__":
    main()
