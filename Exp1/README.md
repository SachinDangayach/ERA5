# Activations exist for a reason

Depth doesn't help without nonlinearity — four small proofs, trained live in your browser.

A single self-contained HTML page (`index.html`) — no build step, no dependencies, no server. Every model is generated, trained, and plotted with plain JavaScript on load / on demand, right there in the tab.

## Run it

Open `index.html` in any modern browser. That's it.

## The four tabs

**S1-1 · Activations exist for a reason**
A model with no nonlinearity can only draw a straight decision boundary, so it can't separate two concentric rings. One linear layer + sigmoid gets stuck near chance (~54–59%); adding a single ReLU hidden layer solves it (~99–100%). Same data, same optimizer — only the activation changes.

**S1-2 · Depth without nonlinearity is a lie**
Composition of linear functions is linear, so five stacked linear layers are exactly as strong as one. The 1-layer and 5-linear-layer models land on the *identical* accuracy and boundary — and multiplying the five weight matrices together numerically returns the 1-layer's weights (cosine similarity 1.0000). Insert a ReLU after each hidden layer and the same five layers suddenly solve the ring.

**S1-3 · Embeddings learn similarity from nothing but next-token**
A toy grammar (animals: cat/dog/cow, fruits: apple/mango, verbs: eat/chase/see) generates sentences. An 8-dimensional embedding table is trained only to predict the next token — category is never a training signal. Projected to 2D with PCA, the three categories visibly cluster, and every token's nearest neighbor by cosine similarity shares its category.

**S1-4 · Memorization vs. generalization**
The same over-parameterized network (2→32→32→1, ~1,200 weights) is trained from scratch on a noisy synthetic task at three sizes: n = 20, 200, 2000. At n=20 it memorizes (train ≈100%, test ~65%, a ~35pp gap); by n=2000 the gap nearly closes (~2–3pp). Same architecture, same optimizer, same number of steps — only the amount of data changes.

## How it works

- **Data & models**: generated and trained with hand-written JavaScript (gradient descent with momentum, full-batch for the smaller nets, mini-batch SGD for S1-4). No ML libraries — every forward/backward pass is explicit.
- **Reproducibility**: a seeded PRNG (mulberry32) drives data generation and weight init. Each tab has a "regenerate & retrain" button that reseeds and reruns from scratch, live.
- **Rendering**: decision boundaries are drawn as a shaded probability field on `<canvas>` (blue↔red, fading to the background right at the p=0.5 seam), with the actual data points scattered on top.
- **Performance**: tabs 2–4 train lazily on first visit (not on page load), so opening the page stays instant. Each retrain takes well under a second for S1-1–S1-3, and a couple of seconds for S1-4 (three networks trained back to back).

## Design

A light "paper/notebook" look — off-white page, white index-card panels, ink-navy text, and a warm amber accent. Blue/red mark the two ring classes; aqua/amber/violet mark the S1-3 word categories. Colors are checked for colorblind-safety (CVD separation, lightness/chroma bands, contrast) against the panel surface. Tabs are styled as bordered index cards, with the active tab raised (white fill, bold label, amber top bar) so the current proof is unambiguous at a glance.
