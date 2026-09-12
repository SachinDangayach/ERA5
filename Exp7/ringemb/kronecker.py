"""
ringemb.kronecker -- a faithful miniature of the Kronecker word block.

This is the *existing* part of the embedding, reproduced from the V4 recipe
described in the session:

    * take a fixed byte window (32 slots),
    * fill it with the UTF-8 bytes of the token,
    * push each byte through a FIXED (never-trained) random matrix to get a
      d_word vector,
    * add a fixed positional embedding so the model can see spelling order,
    * sum the slots and divide by the number of real characters.

Everything here is deterministic and non-trainable: the same string always
produces the same vector, which is the property the whole assignment builds on.
Problem 1 leaves this block untouched and *appends* the math block after it.
"""

from __future__ import annotations

import numpy as np

BYTE_VALUES = 256


class KroneckerWordBlock:
    def __init__(self, d_word: int = 128, window: int = 32, seed: int = 0):
        self.d_word = d_word
        self.window = window
        rng = np.random.default_rng(seed)
        scale = 1.0 / np.sqrt(d_word)
        # fixed, non-trainable
        self.byte_matrix = rng.normal(0.0, scale, size=(BYTE_VALUES, d_word))
        self.pos_matrix = rng.normal(0.0, scale, size=(window, d_word))

    def encode_one(self, token: str) -> np.ndarray:
        raw = token.encode("utf-8")[: self.window]
        if not raw:
            return np.zeros(self.d_word)
        idx = np.frombuffer(raw, dtype=np.uint8).astype(np.int64)
        vecs = self.byte_matrix[idx] + self.pos_matrix[: len(idx)]
        return vecs.sum(axis=0) / len(idx)

    def encode(self, tokens) -> np.ndarray:
        if isinstance(tokens, str):
            return self.encode_one(tokens)
        return np.stack([self.encode_one(t) for t in tokens], axis=0)

    def truncated(self, token: str) -> bool:
        return len(token.encode("utf-8")) > self.window
