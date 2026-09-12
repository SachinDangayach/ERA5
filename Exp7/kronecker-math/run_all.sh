#!/usr/bin/env bash
# Reproduce every number in the README, then rebuild the webapp.
set -euo pipefail
cd "$(dirname "$0")"

echo "=== E1  exactness (no training) ==============================="
python3 experiments/e1_exactness.py 200000

echo; echo "=== E2  noise tolerance (no training) ========================="
python3 experiments/e2_noise.py 20000

echo; echo "=== E3  transformer, a + b ===================================="
python3 experiments/e3_transformer.py --task add --steps 6000

echo; echo "=== E3  transformer, a x b ===================================="
python3 experiments/e3_transformer.py --task mul --steps 6000

echo; echo "=== E4  words and numbers in one sentence ====================="
python3 experiments/e4_mixed_lm.py --steps 8000

echo; echo "=== E5  the glue can be linear (no training) =================="
python3 experiments/e5_linear_refresh.py 20000

echo; echo "=== figures and webapp ========================================"
python3 experiments/make_figures.py
python3 web/build.py

echo; echo "Done. Open web/index.html, or read README.md."
