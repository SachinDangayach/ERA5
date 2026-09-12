"""
ringemb.rationals -- how far the construction pushes past the integers.

Each prime channel is a finite *field*, so division is exact there too.  That
means the same block that stores an integer can store a rational a/b: encode
a, encode b, divide.  Reading it back is lattice rational reconstruction
(the standard half-extended-Euclid trick), which recovers the unique a/b with
|a|, b <= sqrt(M/2).

So the appended block is not an integer code -- it is a code for Q, closed
under +, -, * and / .
"""

from __future__ import annotations

import math
from fractions import Fraction


def rational_reconstruct(u: int, M: int, bound: int | None = None):
    """Find a/b with a/b == u (mod M), |a| <= bound, 0 < b <= bound.

    Returns a Fraction, or None when no such rational exists.
    """
    if bound is None:
        bound = int(math.isqrt(M // 2))
    u %= M
    if u == 0:
        return Fraction(0, 1)

    r0, r1 = M, u
    s0, s1 = 0, 1
    while r1 > bound:
        q = r0 // r1
        r0, r1 = r1, r0 - q * r1
        s0, s1 = s1, s0 - q * s1
    a, b = r1, s1
    if b < 0:
        a, b = -a, -b
    if b == 0 or b > bound or math.gcd(abs(a), b) != 1:
        return None
    if (a - b * u) % M != 0:
        return None
    return Fraction(a, b)
