"""Render the figures used by the README from the saved results JSON."""

from __future__ import annotations

import json
import pathlib
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Arc, Circle

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from ringemb import MathCodec  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
FIGS = ROOT / "results" / "figures"
FIGS.mkdir(parents=True, exist_ok=True)

SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK2 = "#52514e"
MUTED = "#a8a7a1"
GRID = "#e6e5e1"
S1, S2, S3, S4, S5 = "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE,
    "savefig.facecolor": SURFACE, "text.color": INK,
    "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "axes.edgecolor": GRID, "grid.color": GRID, "grid.linewidth": 0.8,
    "font.size": 10, "axes.titlesize": 11, "axes.titleweight": "bold",
    "axes.spines.top": False, "axes.spines.right": False,
    "lines.linewidth": 2.0, "figure.dpi": 140,
})


def load(name):
    p = RESULTS / name
    return json.loads(p.read_text()) if p.exists() else None


def bar_labels(ax, bars, fmt="{:.1f}%", scale=100.0, small=8.5):
    for b in bars:
        h = b.get_height()
        ax.text(b.get_x() + b.get_width() / 2, h + 1.5, fmt.format(h),
                ha="center", va="bottom", fontsize=small, color=INK2)


# --------------------------------------------------------------------- #
def fig_encoding():
    """How an integer becomes phases, and why adding integers adds angles."""
    codec = MathCodec.for_integers()
    a, b = 9, 47
    rows = [(a, f"E({a})"), (b, f"E({b})"),
            (a + b, f"E({a}) $\\oplus$ E({b})\n= E({a+b})")]
    k = codec.k
    fig, axes = plt.subplots(3, k, figsize=(1.42 * k + 1.4, 5.6))
    for r, (n, label) in enumerate(rows):
        for c, p in enumerate(codec.primes):
            ax = axes[r, c]
            ax.set_aspect("equal")
            ax.set_xlim(-1.35, 1.35)
            ax.set_ylim(-1.35, 1.35)
            ax.axis("off")
            ax.add_patch(Circle((0, 0), 1.0, fill=False, ec=GRID, lw=1.3))
            for j in range(p):     # the p legal lattice points
                th = 2 * np.pi * j / p
                ax.plot([np.cos(th)], [np.sin(th)], ".", color=MUTED, ms=3)
            res = n % p
            th = 2 * np.pi * res / p
            color = S3 if r == 2 else S1
            ax.plot([0, np.cos(th)], [0, np.sin(th)], "-", color=color, lw=2.0,
                    solid_capstyle="round", zorder=2)
            ax.plot([0], [0], "o", color=color, ms=3.2, zorder=3)
            ax.plot([np.cos(th)], [np.sin(th)], "o", color=color, ms=8.5,
                    mec=SURFACE, mew=2, zorder=3)
            ax.text(0, -1.34, f"{n} mod {p} = {res}", ha="center", va="top",
                    fontsize=8, color=INK2)
            if r == 0:
                ax.set_title(f"p = {p}", fontsize=10, color=INK, pad=3)
    fig.subplots_adjust(left=0.135, top=0.90, bottom=0.075, hspace=0.42, wspace=0.15)
    for r, (_, label) in enumerate(rows):
        box = axes[r, 0].get_position()
        fig.text(0.012, box.y0 + box.height / 2, label, ha="left", va="center",
                 fontsize=10.5, color=INK, fontweight="bold")
    fig.suptitle("An integer is a bundle of phases; adding integers adds the angles",
                 fontsize=12.5, color=INK, y=0.975)
    fig.text(0.5, 0.012,
             "Each dial stores one residue as a point on the unit circle. The bottom row is the "
             "elementwise complex product of the top two \u2014 no learning, no lookup.",
             ha="center", fontsize=8.5, color=INK2)
    fig.savefig(FIGS / "fig1_encoding.png", bbox_inches="tight")
    plt.close(fig)
    print("wrote fig1_encoding.png")


# --------------------------------------------------------------------- #
def fig_noise():
    d = load("e2_noise.json")
    if not d:
        return
    e3 = load("e3_add.json")
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11.5, 4.3))

    x = [r["sigma"] for r in d["rows"]]
    series = [("phase_only", "phase-only CRT", S5),
              ("ml", "nearest-codeword (ML)", S2),
              ("ml_rrns", "ML + error correction", S1)]
    for key, label, col in series:
        y = [100 * r[key] for r in d["rows"]]
        ax1.plot(x, y, color=col, label=label)
    ax1.axhline(99, color=MUTED, lw=1, ls=":")
    ax1.text(0.5, 99, " 99%", va="bottom", ha="right", fontsize=8, color=INK2)

    if e3:
        arm = next((a for a in e3["arms"] if a["arm"] == "C_kron_math__block"), None)
        if arm and "block_rmse_ood" in arm:
            r = arm["block_rmse_ood"]
            ax1.axvline(r, color=INK, lw=1.4, ls="--")
            ax1.text(r + 0.008, 45, f"trained model's\nactual error\n(RMSE {r:.3f})",
                     fontsize=8.5, color=INK)
    ax1.set_xlabel("Gaussian noise on every slot  (\u03c3)")
    ax1.set_ylabel("exact integer recovered  (%)")
    ax1.set_title("How wrong the model may be")
    ax1.set_ylim(-3, 105)
    ax1.grid(axis="y")
    ax1.legend(frameon=False, fontsize=9)

    trade = d["range_vs_robustness"]
    labels = [f"redundancy {t['redundancy']}\nrange < {t['payload']:,}" for t in trade]
    vals = [t["sigma_at_99pct"] for t in trade]
    bars = ax2.bar(labels, vals, color=[S1, S3, S4], width=0.42)
    for b, t in zip(bars, trade):
        ax2.text(b.get_x() + b.get_width() / 2, b.get_height() + 0.006,
                 f"\u03c3 {t['sigma_at_99pct']:.3f}", ha="center", va="bottom",
                 fontsize=9, color=INK2)
    ax2.set_ylabel("largest \u03c3 still at 99% recovery")
    ax2.set_title("Spare primes buy noise headroom")
    ax2.set_ylim(0, max(vals) * 1.3)
    ax2.grid(axis="y")
    fig.tight_layout()
    fig.savefig(FIGS / "fig2_noise.png", bbox_inches="tight")
    plt.close(fig)
    print("wrote fig2_noise.png")


# --------------------------------------------------------------------- #
PRETTY = {
    "A_digit_baseline": "A  digit baseline\n(learned embeddings)",
    "B_kron_only__block": "B  Kronecker only\n(no math block)",
    "C_kron_math__block": "C  math block in\nand out",
    "D_kron_math__residue": "D  math in,\n95-logit head",
    "F_kron_math__digits": "F  math in,\ndigit head",
}


def fig_e3():
    tasks = [(t, load(f"e3_{t}.json")) for t in ("add", "mul")]
    tasks = [(t, d) for t, d in tasks if d]
    if not tasks:
        return
    fig, axes = plt.subplots(1, len(tasks), figsize=(6.6 * len(tasks), 4.6),
                             squeeze=False)
    for ax, (task, d) in zip(axes[0], tasks):
        arms = d["arms"]
        names = [PRETTY.get(a["arm"], a["arm"]) for a in arms]
        pos = np.arange(len(arms))
        ind = [100 * a["acc_in_dist"] for a in arms]
        ood = [100 * a["acc_ood"] for a in arms]
        b1 = ax.bar(pos - 0.19, ind, 0.34, color=S1, label="in-distribution")
        b2 = ax.bar(pos + 0.19, ood, 0.34, color=S2, label="out-of-distribution")
        bar_labels(ax, b1, small=7.5)
        bar_labels(ax, b2, small=7.5)
        ax.set_xticks(pos)
        ax.set_xticklabels(names, fontsize=8)
        ax.set_ylim(0, 112)
        ax.set_yticks([0, 25, 50, 75, 100])
        ax.grid(axis="y")
        ax.set_ylabel("exact-match accuracy (%)")
        lo, hi = d["train_range"]
        olo, ohi = d["ood_range"]
        ax.set_title(f"{'a + b' if d['op'] == '+' else 'a x b'}   "
                     f"trained on {lo}-{hi-1},  tested on {olo}-{ohi-1}", pad=10)
    handles, labels = axes[0][0].get_legend_handles_labels()
    fig.legend(handles, labels, frameon=False, fontsize=9.5, ncol=2,
               loc="upper center", bbox_to_anchor=(0.5, 0.935))
    fig.suptitle("Structure in the embedding is what survives leaving the training range",
                 fontsize=12.5, color=INK, y=0.995)
    fig.tight_layout(rect=(0, 0, 1, 0.90))
    fig.savefig(FIGS / "fig3_transformer.png", bbox_inches="tight")
    plt.close(fig)
    print("wrote fig3_transformer.png")


# --------------------------------------------------------------------- #
def fig_e4():
    d = load("e4_mixed_lm.json")
    if not d:
        return
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11.5, 4.8))
    arms = d["arms"]
    names = ["Kronecker word\nblock only", "word block\n+ math block"]

    pos = np.arange(2)
    b1 = ax1.bar(pos - 0.15, [100 * a["acc_in_dist"] for a in arms], 0.26,
                 color=S1, label="in-distribution")
    b2 = ax1.bar(pos + 0.15, [100 * a["acc_ood"] for a in arms], 0.26,
                 color=S2, label="out-of-distribution")
    bar_labels(ax1, b1)
    bar_labels(ax1, b2)
    ax1.set_xticks(pos)
    ax1.set_xticklabels(names, fontsize=9.5)
    ax1.set_xlim(-0.6, 1.6)
    ax1.set_ylim(0, 112)
    ax1.grid(axis="y")
    ax1.set_ylabel("exact-match accuracy (%)")
    ax1.set_title("Sentences that mix words and numbers", pad=34)
    ax1.legend(frameon=False, fontsize=9, ncol=2, loc="upper center",
               bbox_to_anchor=(0.5, 1.14))

    ops = ["add", "sub", "mul"]
    pp = np.arange(len(ops))
    for j, (arm, col, lab) in enumerate(zip(arms, [S1, S3], ["word block only",
                                                             "word + math block"])):
        vals = [100 * arm[f"acc_ood_{o}"] for o in ops]
        bb = ax2.bar(pp + (j - 0.5) * 0.32, vals, 0.26, color=col, label=lab)
        bar_labels(ax2, bb)
    ax2.set_xticks(pp)
    ax2.set_xticklabels(["addition", "subtraction", "multiplication"], fontsize=9.5)
    ax2.set_ylim(0, 112)
    ax2.grid(axis="y")
    ax2.set_ylabel("out-of-distribution accuracy (%)")
    ax2.set_title("The word block still picks the operation", pad=34)
    ax2.legend(frameon=False, fontsize=9, ncol=2, loc="upper center",
               bbox_to_anchor=(0.5, 1.14))

    fig.tight_layout()
    fig.savefig(FIGS / "fig4_mixed_lm.png", bbox_inches="tight")
    plt.close(fig)
    print("wrote fig4_mixed_lm.png")


if __name__ == "__main__":
    fig_encoding()
    fig_noise()
    fig_e3()
    fig_e4()
