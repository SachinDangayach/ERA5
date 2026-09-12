"""
ringemb.model -- a deliberately small transformer, shared by every arm of the
experiment so that differences come from the embedding, not from capacity.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn


class Block(nn.Module):
    def __init__(self, d_model: int, nhead: int, mult: int = 4, dropout: float = 0.0):
        super().__init__()
        self.n1 = nn.LayerNorm(d_model)
        self.attn = nn.MultiheadAttention(d_model, nhead, dropout=dropout, batch_first=True)
        self.n2 = nn.LayerNorm(d_model)
        self.ff = nn.Sequential(
            nn.Linear(d_model, mult * d_model), nn.GELU(),
            nn.Linear(mult * d_model, d_model),
        )

    def forward(self, x):
        h = self.n1(x)
        x = x + self.attn(h, h, h, need_weights=False)[0]
        x = x + self.ff(self.n2(x))
        return x


class TinyFormer(nn.Module):
    """Encoder-only. The answer is read off the last position.

    input_mode:
      "features" -- tokens arrive as fixed feature vectors (Kronecker word
                    block, optionally with the math block appended). Nothing
                    about the token table is learned; only the projection is.
      "vocab"    -- classic learned embedding table over a small symbol vocab.

    head_mode:
      "block"    -- regress the math block directly (dim = codec.dim)
      "residue"  -- one small softmax per prime (sum of primes logits total)
      "digits"   -- n_digits independent 10-way softmaxes (the standard way)
    """

    def __init__(self, *, input_mode: str, head_mode: str, seq_len: int,
                 in_dim: int = 0, vocab: int = 0, d_model: int = 128,
                 nhead: int = 4, nlayers: int = 2, out_dim: int = 0,
                 primes: tuple[int, ...] = (), n_digits: int = 6):
        super().__init__()
        self.input_mode = input_mode
        self.head_mode = head_mode
        self.primes = primes
        self.n_digits = n_digits

        if input_mode == "features":
            self.proj = nn.Linear(in_dim, d_model)
        else:
            self.emb = nn.Embedding(vocab, d_model)

        self.pos = nn.Parameter(torch.randn(seq_len, d_model) * 0.02)
        self.blocks = nn.ModuleList([Block(d_model, nhead) for _ in range(nlayers)])
        self.norm = nn.LayerNorm(d_model)

        if head_mode == "block":
            self.head = nn.Linear(d_model, out_dim)
        elif head_mode == "residue":
            self.head = nn.Linear(d_model, sum(primes))
        else:
            self.head = nn.Linear(d_model, n_digits * 10)

    def forward(self, x):
        h = self.proj(x) if self.input_mode == "features" else self.emb(x)
        h = h + self.pos[: h.shape[1]]
        for b in self.blocks:
            h = b(h)
        return self.head(self.norm(h)[:, -1])

    def n_params(self) -> int:
        return sum(p.numel() for p in self.parameters())
