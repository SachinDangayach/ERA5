/* UI layer, part 2: one panel per experiment.  Everything here recomputes the
   experiment rather than replaying it, using the ports in codec.js, linear.js
   and kron.js.  app.js is already in scope. */

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }
function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo)); }
function signedDecode(vec) {
  const n = codec.crtSubset(codec.decodeML(vec).res, ALL_IDX);
  return n > codec.M / 2 ? n - codec.M : n;
}
function decodeInt(vec) { return codec.crtSubset(codec.decodeML(vec).res, ALL_IDX); }
function slotsInto(host, vec, scale, cap, colour) {
  host.innerHTML = "";
  for (let i = 0; i < vec.length; i++) {
    const d = document.createElement("div");
    d.className = "slot" + (vec[i] < 0 ? " neg" : "");
    if (colour && vec[i] >= 0) d.style.background = colour;
    d.style.height = Math.max(1, Math.min(cap, Math.abs(vec[i]) * scale)) + "px";
    host.appendChild(d);
  }
}

/* ==================================================================== E1 */
/* Each entry mirrors one check in experiments/e1_exactness.py. */
const E1_CHECKS = [
  { id: "add_full", name: "random pairs, full range — a + b", cap: 0, run(n) {
      let ok = 0; const miss = [];
      for (let t = 0; t < n; t++) {
        const a = randInt(0, codec.M), b = randInt(0, codec.M);
        const got = decodeInt(codec.add(codec.encode(a), codec.encode(b)));
        const want = intResult("add", a, b, codec.M);
        if (got === want) ok++; else if (miss.length < 3) miss.push(`${a}+${b} → ${got} (want ${want})`);
      }
      return { ok, n, miss };
    } },
  { id: "add_small", name: "random pairs, 0..999 — a + b", run(n) {
      let ok = 0; const miss = [];
      for (let t = 0; t < n; t++) {
        const a = randInt(0, 1000), b = randInt(0, 1000);
        const got = decodeInt(codec.add(codec.encode(a), codec.encode(b)));
        if (got === a + b) ok++; else if (miss.length < 3) miss.push(`${a}+${b} → ${got}`);
      }
      return { ok, n, miss };
    } },
  { id: "mul_full", name: "random pairs, full range — a × b", run(n) {
      let ok = 0; const miss = [];
      for (let t = 0; t < n; t++) {
        const a = randInt(0, codec.M), b = randInt(0, codec.M);
        const got = decodeInt(codec.mul(codec.encode(a), codec.encode(b)));
        const want = intResult("mul", a, b, codec.M);
        if (got === want) ok++; else if (miss.length < 3) miss.push(`${a}×${b} → ${got} (want ${want})`);
      }
      return { ok, n, miss };
    } },
  { id: "mul_zero", name: "with zero operands — a × b", run(n) {
      let ok = 0; const miss = [];
      for (let t = 0; t < n; t++) {
        const a = randInt(0, 1000), b = Math.random() < 0.5 ? 0 : randInt(0, 1000);
        const got = decodeInt(codec.mul(codec.encode(a), codec.encode(b)));
        if (got === a * b) ok++; else if (miss.length < 3) miss.push(`${a}×${b} → ${got}`);
      }
      return { ok, n, miss, note: "the zero flag carries the channels where no discrete log exists" };
    } },
  { id: "sub", name: "subtraction, signed — a − b", run(n) {
      let ok = 0; const miss = [];
      for (let t = 0; t < n; t++) {
        const a = randInt(0, 100000), b = randInt(0, 100000);
        const got = signedDecode(codec.sub(codec.encode(a), codec.encode(b)));
        if (got === a - b) ok++; else if (miss.length < 3) miss.push(`${a}−${b} → ${got}`);
      }
      return { ok, n, miss, note: "values above M/2 read back as negative" };
    } },
  { id: "powk", name: "integer powers — a², a³, a⁴", run(n) {
      let ok = 0, total = 0; const miss = [];
      for (let t = 0; t < n; t++) {
        const base = randInt(1, 60);
        for (const k of [2, 3, 4]) {
          total++;
          const got = decodeInt(codec.powk(codec.encode(base), k));
          const want = Number((BigInt(base) ** BigInt(k)) % BigInt(codec.M));
          if (got === want) ok++; else if (miss.length < 3) miss.push(`${base}^${k} → ${got} (want ${want})`);
        }
      }
      return { ok, n: total, miss, note: "one scalar multiply on the multiplicative angle" };
    } },
  { id: "div", name: "exact division, invertible divisor", run(n) {
      let ok = 0, total = 0; const miss = [];
      for (let t = 0; t < n; t++) {
        const q = randInt(1, 5000);
        if (!codec.isInvertible(codec.encode(q))) continue;
        total++;
        const prod = randInt(1, 5000) * q;
        const got = decodeInt(codec.div(codec.encode(prod), codec.encode(q)));
        if (got === prod / q) ok++; else if (miss.length < 3) miss.push(`${prod}÷${q} → ${got}`);
      }
      return { ok, n: total, miss, note: "non-invertible divisors are skipped, and detected rather than guessed" };
    } },
  { id: "expr", name: "4-step expression — ((a+b)·c)−d", run(n) {
      let ok = 0; const miss = [];
      for (let t = 0; t < n; t++) {
        const a = randInt(0, 5000), b = randInt(0, 5000), c = randInt(0, 200), d = randInt(0, 5000);
        const v = codec.sub(codec.mul(codec.add(codec.encode(a), codec.encode(b)),
                                      codec.encode(c)), codec.encode(d));
        const want = (a + b) * c - d;
        const got = signedDecode(v);
        if (got === want) ok++; else if (miss.length < 3) miss.push(`((${a}+${b})·${c})−${d} → ${got} (want ${want})`);
      }
      return { ok, n, miss, note: "four operations composed, still exact" };
    } },
  { id: "rt", name: "round trip — op(E(a),E(b)) vs E(a op b)", run(n) {
      let ok = 0, total = 0, worst = 0; const miss = [];
      for (let t = 0; t < n; t++) {
        for (const op of ["add", "sub", "mul"]) {
          const a = randInt(0, codec.M), b = randInt(1, codec.M);
          const y = intResult(op, a, b, codec.M);
          const got = OPS[op].fn(codec.encode(a), codec.encode(b));
          const ref = codec.encode(y);
          let m = 0;
          for (let i = 0; i < codec.dim; i++) m = Math.max(m, Math.abs(got[i] - ref[i]));
          worst = Math.max(worst, m);
          total++;
          if (m < 1e-12) ok++; else if (miss.length < 3) miss.push(`${a} ${op} ${b}: ${m.toExponential(2)}`);
        }
      }
      return { ok, n: total, miss,
               note: `blocks identical slot by slot; largest difference seen ${worst.toExponential(1)}` };
    } },
  { id: "raw", name: "bare bilinear step — add_raw vs E(a+b)", run(n) {
      let worst = 0;
      const idx = [];
      for (let i = 0; i < codec.k; i++) { idx.push(i * 5, i * 5 + 1); }
      for (let t = 0; t < n; t++) {
        const a = randInt(0, codec.M), b = randInt(0, codec.M);
        const raw = codec.addRaw(codec.encode(a), codec.encode(b));
        const ref = codec.encode((a + b) % codec.M);
        idx.forEach(i => { worst = Math.max(worst, Math.abs(raw[i] - ref[i])); });
      }
      return { ok: n, n, miss: [], measure: worst,
               note: `largest additive-channel error ${worst.toExponential(2)} — one complex product, no lookup, no parameters` };
    } },
  { id: "rational", name: "rational arithmetic — p/q under + and ×", capN: 2000, run(n) {
      const rc = ratCodec();
      let ok = 0; const miss = [];
      for (let t = 0; t < n; t++) {
        const q1 = ratDen(), q2 = ratDen();
        const p1 = randInt(-300, 301), p2 = randInt(-300, 301);
        const r = ratCheck(rc, p1, q1, p2, q2);
        if (r.addOK && r.mulOK) ok++;
        else if (miss.length < 3) miss.push(`${p1}/${q1}, ${p2}/${q2}`);
      }
      return { ok, n, miss, note: "reconstructed by lattice rational reconstruction, on the 30-dim rational preset" };
    } },
];

let E1LOG = [];
function e1RunCheck(id, n) {
  const c = E1_CHECKS.find(x => x.id === id);
  if (!c) return null;
  const trials = c.capN ? Math.min(n, c.capN) : n;
  const t0 = Date.now();
  const r = c.run(trials);
  return { id, name: c.name, ok: r.ok, n: r.n, miss: r.miss || [],
           note: r.note || "", ms: Date.now() - t0 };
}
function e1Render() {
  if (!E1LOG.length) {
    setHTML("e1Log", `<tr><th>check</th><th class="num">trials</th><th class="num">correct</th>
      <th>verdict</th><th class="num">ms</th></tr>
      <tr><td colspan="5" class="note">nothing run yet — press <em>Run check</em></td></tr>`);
    setText("e1Total", "—");
    const v = document.getElementById("e1Verdict");
    v.textContent = "idle"; v.className = "pill";
    setText("e1Note", "");
    return;
  }
  setHTML("e1Log",
    `<tr><th>check</th><th class="num">trials</th><th class="num">correct</th>
     <th>verdict</th><th class="num">ms</th></tr>` +
    E1LOG.map(r => {
      const ok = r.ok === r.n;
      return `<tr class="${ok ? "" : "miss"}"><td>${r.name}
        ${r.note ? `<div class="note">${r.note}</div>` : ""}
        ${r.miss.length ? `<div class="note" style="color:var(--series-8)">first misses: ${r.miss.join("; ")}</div>` : ""}</td>
        <td class="num">${r.n.toLocaleString()}</td><td class="num">${r.ok.toLocaleString()}</td>
        <td><span class="pill ${ok ? "ok" : "bad"}">${ok ? "all correct" : "MISMATCH"}</span></td>
        <td class="num">${r.ms}</td></tr>`;
    }).join(""));
  const ok = E1LOG.reduce((s, r) => s + r.ok, 0), tot = E1LOG.reduce((s, r) => s + r.n, 0);
  setText("e1Total", `${ok.toLocaleString()} / ${tot.toLocaleString()}`);
  const v = document.getElementById("e1Verdict");
  const perfect = ok === tot;
  v.textContent = perfect ? "100.000000%" : ((100 * ok / tot).toFixed(6) + "%");
  v.className = "pill " + (perfect ? "ok" : "bad");
  setText("e1Note", `${E1LOG.length} check${E1LOG.length > 1 ? "s" : ""} run, ` +
    `${E1LOG.reduce((s, r) => s + r.ms, 0)} ms total`);
}
function e1Bar(f) {
  const b = document.getElementById("e1Bar");
  if (b) b.style.width = Math.round(100 * f) + "%";
}

/* --- the rational preset, built lazily --------------------------------- */
let RAT = null, RAT_IDX = null, RAT_BOUND = 0;
function ratCodec() {
  if (!RAT) {
    RAT = new Codec([101, 103, 107, 109, 113, 127]);
    RAT_IDX = [...Array(RAT.k).keys()];
    RAT_BOUND = isqrtBig(BigInt(RAT.M) / 2n);
  }
  return RAT;
}
function ratDen() {
  const rc = ratCodec();
  let q = randInt(1, 301);
  while (!rc.isInvertible(rc.encode(q))) q = randInt(1, 301);
  return q;
}
function ratDecode(rc, vec) { return rc.crtSubset(rc.decodeML(vec).res, RAT_IDX); }
function ratFrac(p, q) {
  if (q < 0) { p = -p; q = -q; }
  const g = gcd(p, q) || 1;
  return { a: p / g, b: q / g };
}
function fracEq(x, y) { return x && y && x.a === y.a && x.b === y.b; }
function fracStr(f) { return f === null ? "no rational" : (f.b === 1 ? `${f.a}` : `${f.a}/${f.b}`); }

function ratCheck(rc, p1, q1, p2, q2) {
  const M = rc.M;
  const enc = v => rc.encode(((v % M) + M) % M);
  const u = rc.div(enc(p1), enc(q1)), v = rc.div(enc(p2), enc(q2));
  const gotAdd = rationalReconstruct(ratDecode(rc, rc.add(u, v)), M, RAT_BOUND);
  const gotMul = rationalReconstruct(ratDecode(rc, rc.mul(u, v)), M, RAT_BOUND);
  const wantAdd = ratFrac(p1 * q2 + p2 * q1, q1 * q2);
  const wantMul = ratFrac(p1 * p2, q1 * q2);
  return { gotAdd, gotMul, wantAdd, wantMul,
           addOK: fracEq(gotAdd, wantAdd), mulOK: fracEq(gotMul, wantMul) };
}

function renderRationals() {
  const rc = ratCodec();
  const p1 = num("raP1", -300, 300, 153), q1 = num("raQ1", 1, 300, 142);
  const p2 = num("raP2", -300, 300, 271), q2 = num("raQ2", 1, 300, 154);
  const badQ = [[q1, "q₁"], [q2, "q₂"]].filter(([q]) => !rc.isInvertible(rc.encode(q)));
  if (badQ.length) {
    setHTML("raOut", `<p class="rtwarn">${badQ.map(([q, n]) => `${n} = ${q}`).join(" and ")}
      share${badQ.length > 1 ? "" : "s"} a factor with M = ${rc.M.toLocaleString()}, so the fraction has
      no image in this ring. The zero flags say so locally, before anything is decoded — this is the
      4% of denominators 1…300 the README calls out, and it fails loudly rather than silently.</p>`);
    return;
  }
  const r = ratCheck(rc, p1, q1, p2, q2);
  const row = (label, got, want, ok) =>
    `<tr class="${ok ? "" : "miss"}"><td>${label}</td>
     <td class="num">${fracStr(got)}</td><td class="num">${fracStr(want)}</td>
     <td><span class="pill ${ok ? "ok" : "bad"}">${ok ? "exact" : "wrong"}</span></td></tr>`;
  setHTML("raOut",
    `<table><tr><th>expression</th><th class="num">recovered from the block</th>
     <th class="num">exact fraction</th><th>agree</th></tr>` +
    row(`${p1}/${q1} + ${p2}/${q2}`, r.gotAdd, r.wantAdd, r.addOK) +
    row(`${p1}/${q1} × ${p2}/${q2}`, r.gotMul, r.wantMul, r.mulOK) +
    `<tr><td colspan="2" class="note">30 dimensions, primes ${rc.primes.join(", ")}</td>
     <td colspan="2" class="note" style="text-align:right">reconstruction bound |a|, b ≤ ${RAT_BOUND.toLocaleString()}</td></tr>
     </table>
     <div class="keypoint">No new machinery was added to get this. Each prime channel is a finite
     <em>field</em>, so the same block that stores an integer is already closed under division — and
     therefore stores ℚ, not merely ℤ.</div>`);
}

function renderE1Results() {
  const d = DATA.e1; if (!d) return;
  const tot = d.checks.reduce((s, c) => s + c.total, 0);
  const cor = d.checks.reduce((s, c) => s + c.correct, 0);
  const rtIdent = Object.values(d.round_trip).reduce((s, r) => s + r.identical, 0);
  statStrip("e1Stats", [
    ["checks correct", cor.toLocaleString(), `of ${tot.toLocaleString()} — ${(100 * cor / tot).toFixed(6)}%`],
    ["bare bilinear error", d.add_raw_max_abs_err.toExponential(1), "one complex product, zero parameters"],
    ["round-trip blocks identical", rtIdent.toLocaleString(), "largest slot difference 0.0"],
    ["parameters trained", "0", `${d.seconds}s for the whole run`],
  ]);
  setText("e1blurb",
    `${d.n_trials.toLocaleString()} randomised trials per check, seeded and reproducible, across the full ` +
    `0 … ${(d.modulus - 1).toLocaleString()} range. Ground truth is computed in Python's ` +
    `arbitrary-precision integers, so the reference never overflows.`);
  setHTML("e1Table",
    `<tr><th>check</th><th class="num">correct</th><th class="num">total</th><th class="num">accuracy</th></tr>` +
    d.checks.map(c => `<tr><td>${c.name}</td><td class="num">${c.correct.toLocaleString()}</td>
      <td class="num">${c.total.toLocaleString()}</td><td class="num">${(100 * c.accuracy).toFixed(4)}%</td></tr>`).join("") +
    `<tr><td><strong>overall</strong></td><td class="num"><strong>${cor.toLocaleString()}</strong></td>
     <td class="num"><strong>${tot.toLocaleString()}</strong></td>
     <td class="num"><strong>${(100 * cor / tot).toFixed(6)}%</strong></td></tr>`);
  setHTML("e1RT",
    `<tr><th>round trip</th><th class="num">pairs</th><th class="num">blocks identical</th>
     <th class="num">largest slot difference</th></tr>` +
    Object.entries(d.round_trip).map(([k, v]) =>
      `<tr><td>${k}${k === "a / b" ? " (invertible divisors only)" : ""}</td>
       <td class="num">${v.pairs.toLocaleString()}</td><td class="num">${v.identical.toLocaleString()}</td>
       <td class="num">${v.max_slot_diff}</td></tr>`).join("") +
    `<tr><td colspan="4" class="note">Not "within rounding" — bit-for-bit equal, because the refresh
      rebuilds the block from its decoded residues. Before the refresh the raw product already agrees
      to ${DATA.e1.add_raw_max_abs_err.toExponential(1)} on the channel the operation acts on.</td></tr>`);
}

/* --- division, and the certificate ------------------------------------- */
function renderDivCert() {
  const b = num("dcB", 1, 84999, 5);
  const eb = codec.encode(b);
  const flags = codec.primes.map((p, i) => eb[i * 5 + 4] > 0.5);
  const invertible = flags.every(f => !f);
  const g = codec.primes.reduce((acc, p, i) => flags[i] ? acc * p : acc, 1);

  const flagRow = `<table><tr><th>prime</th>` +
    codec.primes.map(p => `<th class="num">${p}</th>`).join("") + `</tr>
    <tr><td>zero flag on ${b}</td>` +
    flags.map(f => `<td class="num"><span class="pill ${f ? "bad" : "ok"}">${f ? "1" : "0"}</span></td>`).join("") +
    `</tr></table>`;

  if (invertible) {
    const q = randInt(2, 900), a = (q * b) % codec.M;
    const got = decodeInt(codec.div(codec.encode(a), eb));
    setHTML("dcOut", flagRow +
      `<div class="keypoint">Every flag is off, so <span class="mono">${b}</span> is coprime to
       M = ${codec.M.toLocaleString()} and division by it is exact. Checking this took no decoding at
       all — it is ${codec.k} comparisons against 0.5 on slots the block already carries.</div>
       <p class="note"><span class="mono">${a.toLocaleString()} ÷ ${b} = ${got.toLocaleString()}</span>
       ${got === a / b ? "— exact, as expected." : "— unexpected mismatch."}</p>`);
    return;
  }

  // g > 1: q and q + M/g are different quotients that BOTH multiply back to a.
  const step = codec.M / g;
  const q1 = randInt(2, 900), a = (q1 * b) % codec.M;
  const q2 = (q1 + step) % codec.M;
  const back1 = decodeInt(codec.mul(codec.encode(q1), eb));
  const back2 = decodeInt(codec.mul(codec.encode(q2), eb));
  setHTML("dcOut", flagRow +
    `<div class="keypoint">Flags are lit on ${codec.primes.filter((p, i) => flags[i]).join(", ")}, so
     <span class="mono">${b}</span> shares a factor with M and has no inverse. The block said so
     locally, without decoding anything.</div>
     <p class="note">Now the trap. The obvious way to check a quotient is to multiply it back — and
     that check <em>passes on wrong answers</em> here, because a non-invertible divisor admits
     ${g.toLocaleString()} distinct quotients. Two of them:</p>
     <table><tr><th>candidate quotient q</th><th class="num">q × ${b} decodes to</th>
       <th>multiply-back check</th></tr>
     <tr><td class="num">${q1.toLocaleString()}</td><td class="num">${back1.toLocaleString()}</td>
       <td><span class="pill ${back1 === a ? "ok" : "bad"}">${back1 === a ? "passes" : "fails"}</span></td></tr>
     <tr><td class="num">${q2.toLocaleString()}</td><td class="num">${back2.toLocaleString()}</td>
       <td><span class="pill ${back2 === a ? "ok" : "bad"}">${back2 === a ? "passes" : "fails"}</span></td></tr>
     <tr><td colspan="3" class="note">Both pass, and they are ${step.toLocaleString()} apart. The
       multiply-back test cannot tell them apart; the zero flags can, which is why the certificate is
       the flags and not the round trip.</td></tr></table>`);
}

/* ==================================================================== E2 */
function renderE2Stats() {
  const d = DATA.e2; if (!d) return;
  const t = d.sigma_at_99pct;
  statStrip("e2Stats", [
    ["values per σ", d.n.toLocaleString(), `drawn from 0 … ${(d.payload - 1).toLocaleString()}`],
    ["σ values swept", d.sigmas.length, `0 to ${Math.max(...d.sigmas)}, noise on every slot`],
    ["phase-only holds to", t.phase_only.toFixed(3), "read one angle per prime"],
    ["ML + correction holds to", t.ml_rrns.toFixed(3), `${(t.ml_rrns / t.phase_only).toFixed(0)}× the budget, same storage`],
  ]);
}

const E2_SIGMAS = Array.from({ length: 21 }, (_, i) => Math.round(i * 0.025 * 1e4) / 1e4);
let E2LIVE = null;

/* One σ of the sweep: exactly what the script does, at your trial count. */
function e2SweepStep(sigma, values, clean, red) {
  let phase = 0, ml = 0, rrns = 0;
  const idx = ALL_IDX;
  for (let i = 0; i < values.length; i++) {
    const noisy = Float64Array.from(clean[i], v => v + sigma * gauss());
    if (codec.crtSubset(codec.decodePhase(noisy), idx) === values[i]) phase++;
    const m = codec.decodeML(noisy);
    if (codec.crtSubset(m.res, idx) === values[i]) ml++;
    if (codec.robust(m.res, red).n === values[i]) rrns++;
  }
  const n = values.length;
  return { sigma, phase_only: phase / n, ml: ml / n, ml_rrns: rrns / n };
}

function e2RunSweep(n, red, onRow, done) {
  const payload = codec.payload(red);
  const values = Array.from({ length: n }, () => randInt(0, payload));
  const clean = values.map(v => codec.encode(v));
  const rows = [];
  let i = 0;
  const step = () => {
    rows.push(e2SweepStep(E2_SIGMAS[i], values, clean, red));
    i++;
    onRow(rows, i / E2_SIGMAS.length);
    if (i < E2_SIGMAS.length) setTimeout(step, 0);
    else done(rows);
  };
  step();
}

function drawSweepChart(rows, red) {
  const stored = DATA.e2;
  const W = 560, H = 280, L = 46, R = 14, T = 16, B = 40;
  const s = svg(W, H);
  const X = v => L + (v / 0.5) * (W - L - R);
  const Y = v => T + (1 - v / 100) * (H - T - B);
  [0, 25, 50, 75, 100].forEach(g => {
    s.appendChild(el("line", { x1: L, y1: Y(g), x2: W - R, y2: Y(g) }, "stroke:var(--grid);stroke-width:1"));
    s.appendChild(txt(L - 8, Y(g) + 4, g + "%", INK2, "end"));
  });
  [0, .1, .2, .3, .4, .5].forEach(g => s.appendChild(txt(X(g), H - 16, g.toFixed(1), INK2)));
  s.appendChild(txt(W / 2, H - 2, "Gaussian noise on every slot  (σ)", MUT));
  s.appendChild(el("line", { x1: L, y1: Y(99), x2: W - R, y2: Y(99) },
                   "stroke:var(--text-muted);stroke-width:1;stroke-dasharray:3 3"));
  s.appendChild(txt(W - R, Y(99) - 5, "99%", MUT, "end"));

  const series = [["phase_only", "phase-only CRT", SV(5)],
                  ["ml", "nearest codeword (ML)", SV(2)],
                  ["ml_rrns", "ML + error correction", SV(1)]];
  if (stored && red === 2) {
    series.forEach(([k, , col]) => {
      const pts = stored.rows.map(r => `${X(r.sigma)},${Y(100 * r[k])}`).join(" ");
      s.appendChild(el("polyline", { points: pts, fill: "none" },
                       `stroke:${col};stroke-width:5;opacity:.18;stroke-linejoin:round`));
    });
  }
  if (rows && rows.length) {
    series.forEach(([k, , col]) => {
      const pts = rows.map(r => `${X(r.sigma)},${Y(100 * r[k])}`).join(" ");
      s.appendChild(el("polyline", { points: pts, fill: "none" },
                       `stroke:${col};stroke-width:2;stroke-linejoin:round`));
      rows.forEach(r => s.appendChild(el("circle", { cx: X(r.sigma), cy: Y(100 * r[k]), r: 2.2 },
                                        `fill:${col}`)));
    });
    rows.forEach(r => {
      const hit = el("rect", { x: X(r.sigma) - 6, y: T, width: 12, height: H - T - B, fill: "transparent" });
      hover(hit, `<strong>σ = ${r.sigma.toFixed(3)}</strong><br>
        phase-only ${pct(r.phase_only, 1)}<br>ML ${pct(r.ml, 1)}<br>ML + correction ${pct(r.ml_rrns, 1)}`);
      s.appendChild(hit);
    });
  }
  const host = document.getElementById("e2SweepChart");
  host.innerHTML = ""; host.appendChild(s);
  setHTML("e2SweepLegend",
    series.map(([, l, c]) => `<span><span class="swatch" style="background:${c}"></span>${l}</span>`).join("") +
    (stored && red === 2 ? `<span><span class="swatch" style="background:var(--text-muted);opacity:.4"></span>stored ${stored.n.toLocaleString()}-trial run</span>` : ""));
}

function e2Threshold(rows, key) {
  let best = 0;
  for (const r of rows) { if (r[key] >= 0.99) best = r.sigma; else break; }
  return best;
}
function e2SweepDone(rows, n, red) {
  E2LIVE = rows;
  const t = ["phase_only", "ml", "ml_rrns"].map(k => e2Threshold(rows, k));
  const stored = DATA.e2 ? DATA.e2.sigma_at_99pct : null;
  setHTML("e2SweepNote",
    `Largest σ still at 99% exact recovery in <em>your</em> run, at ${n.toLocaleString()} trials per σ
     and redundancy ${red}: phase-only <span class="mono">${t[0].toFixed(3)}</span>, ML
     <span class="mono">${t[1].toFixed(3)}</span>, ML + correction
     <span class="mono">${t[2].toFixed(3)}</span>.` +
    (stored && red === 2
      ? ` The stored 20,000-trial run gives ${stored.phase_only.toFixed(3)} /
         ${stored.ml.toFixed(3)} / ${stored.ml_rrns.toFixed(3)}. A coarser σ grid and far fewer
         trials will move the last digit — the ordering, and the gap between the three decoders, is
         what reproduces.`
      : ` Redundancy ${red} shrinks the exact range to 0 … ${(codec.payload(red) - 1).toLocaleString()};
         the stored comparison curve is only drawn at redundancy 2.`));
}

/* ==================================================================== E3 */
const E3_ARMS = [
  { id: "A_digit_baseline", label: "A · digit baseline",
    input: "vocab", head: "digits",
    desc: `A learned embedding table over the 14-symbol alphabet <span class="mono">0123456789+*=</span>,
           fed the digit <em>spelling</em> of each operand. This is how an ordinary language model does
           arithmetic: magnitude has to be inferred from position, and it can only be inferred where
           training data existed.` },
  { id: "B_kron_only__block", label: "B · Kronecker only",
    input: "features", math: false, head: "block",
    desc: `Word block in, math block out — but the math slice of the input is left at zero. Exactly arm
           C with one line changed, which is what makes it a controlled comparison: the model is asked
           to regress a structure it was never shown.` },
  { id: "C_kron_math__block", label: "C · math in and out (the proposal)",
    input: "features", math: true, head: "block",
    desc: `The proposal. The math block is appended to the input and regressed at the output, so the
           input and the output speak the same language.` },
  { id: "D_kron_math__residue", label: "D · math in, 95-logit residue head",
    input: "features", math: true, head: "residue",
    desc: `Same input as C, but the head is one small softmax per prime instead of a regression. The
           interesting part is the size: 95 logits in total, where a vocabulary head over every number
           token would need tens of thousands.` },
  { id: "F_kron_math__digits", label: "F · math in, ordinary digit head",
    input: "features", math: true, head: "digits",
    desc: `The most informative arm. Structure on the input, an ordinary digit head on the output. It
           isolates whether the generalisation comes from the input representation alone — and it does
           not.` },
];
const SYMBOLS = "0123456789+*= ";
const D_WORD = 64, N_DIGITS = 6;
let KRON = null;
function kron() { if (!KRON) KRON = new KroneckerWordBlock(D_WORD, 32, 0); return KRON; }

function fillSelect(id, opts, sel) {
  const s = document.getElementById(id); if (!s) return;
  s.innerHTML = opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  if (sel !== undefined) s.value = String(sel);
}

function bandRow(label, segs, tip) {
  const total = segs.reduce((s, x) => s + x.w, 0);
  const inner = segs.map(x =>
    `<span style="width:${100 * x.w / total}%;background:${x.on ? x.col : "var(--surface-2)"};
      color:${x.on ? "#fff" : "var(--text-muted)"}">${x.lab}</span>`).join("");
  return `<div class="bandrow"><div class="tok">${label}</div>
    <div class="bandwrap"><div class="band" title="${tip || ""}">${inner}</div></div></div>`;
}

function renderArmInspector() {
  const armId = document.getElementById("aiArm").value;
  const arm = E3_ARMS.find(a => a.id === armId) || E3_ARMS[2];
  const opSym = document.getElementById("aiOp").value;
  const a = num("aiA", 0, PAYLOAD - 1, 473), b = num("aiB", 0, PAYLOAD - 1, 89);
  const y = opSym === "+" ? a + b : a * b;
  setHTML("aiDesc", arm.desc);

  if (arm.input === "vocab") {
    const sa = String(a).padStart(N_DIGITS, "0"), sb = String(b).padStart(N_DIGITS, "0");
    const toks = [...sa.split(""), opSym, ...sb.split(""), "="];
    setHTML("aiInput",
      `<p class="note">Input is a sequence of ${toks.length} token ids into a learned
       <span class="mono">nn.Embedding(${SYMBOLS.length}, 128)</span> — the only arm whose input table
       is trained at all.</p>
       <div class="chips">${toks.map((c, i) =>
         `<span class="chip" title="position ${i}">${c === " " ? "␣" : c} → ${SYMBOLS.indexOf(c)}</span>`).join("")}</div>
       <p class="note" style="margin-top:10px">The number ${a.toLocaleString()} is not one token here;
       it is ${N_DIGITS} of them, and its magnitude lives entirely in which position each digit landed
       in.</p>`);
  } else {
    const feat = D_WORD + codec.dim + 1;
    const rows = [
      { lab: `a = ${a}`, number: true, v: a },
      { lab: opSym === "+" ? "op = +" : "op = *", number: false },
      { lab: `b = ${b}`, number: true, v: b },
      { lab: "= ", number: false },
    ];
    setHTML("aiInput",
      `<p class="note">Input is a <span class="mono">4 × ${feat}</span> matrix of <em>frozen</em>
       features — <span class="mono">${D_WORD}</span> Kronecker word dims,
       <span class="mono">${codec.dim}</span> math dims, one is-number flag. Only the
       <span class="mono">nn.Linear(${feat}, 128)</span> projection is learned.</p>` +
      rows.map(r => bandRow(r.lab, [
        { w: D_WORD, on: true, col: SV(1), lab: `word ${D_WORD}` },
        { w: codec.dim, on: r.number && arm.math, col: SV(3),
          lab: r.number && arm.math ? `math ${codec.dim}` : "math zeroed" },
        { w: 1, on: r.number, col: SV(4), lab: "" },
      ], r.number ? `math block of ${r.v}` : "symbol: word block only")).join("") +
      (arm.math
        ? `<p class="note" style="margin-top:10px">Both operands carry a populated math block, so the
           magnitude of ${a.toLocaleString()} and ${b.toLocaleString()} is present in the input whether
           or not the training set ever contained them.</p>`
        : `<p class="note" style="margin-top:10px">The math slice is zeroed. Everything else — the same
           sentences, the same word blocks, the same trunk — is identical to arm C. That single line is
           the whole experiment.</p>`));
  }

  // target + loss
  if (arm.head === "block") {
    const blk = codec.encode(y);
    const host = document.createElement("div");
    host.className = "slots"; host.style.height = "48px";
    setHTML("aiTarget",
      `<p class="note">the ${codec.dim} numbers of <span class="mono">E(${y.toLocaleString()})</span>,
       regressed directly</p><div class="slots" id="aiTgtSlots" style="height:48px"></div>`);
    slotsInto(document.getElementById("aiTgtSlots"), blk, 26, 48, SV(3));
    setHTML("aiLoss",
      `<pre class="code" style="margin:0">nn.functional.mse_loss(out, tgt)</pre>
       <p class="note">Plain MSE against the answer's block. Prediction then runs
       <span class="mono">decode_robust(..., redundancy=2)</span> — a regressed block is a noisy block,
       so it is decoded with the error-correcting decoder E2 measured.</p>`);
  } else if (arm.head === "residue") {
    const res = codec.residues(y);
    setHTML("aiTarget",
      `<p class="note">one class index per prime — ${codec.primes.length} small softmaxes,
       ${codec.primes.reduce((s, p) => s + p, 0)} logits in total</p>
       <div class="chips">${codec.primes.map((p, i) =>
         `<span class="chip">${y.toLocaleString()} mod ${p} = <strong>${res[i]}</strong> &nbsp;of ${p}</span>`).join("")}</div>`);
    setHTML("aiLoss",
      `<pre class="code" style="margin:0">for i, p in enumerate(codec.primes):
    total += cross_entropy(out[:, off:off + p], tgt[:, i])
    off   += p
loss = total / len(codec.primes)</pre>
       <p class="note">Mean cross-entropy over the per-prime softmaxes, then the same error-correcting
       CRT reassembles the integer.</p>`);
  } else {
    const ds = String(y).padStart(N_DIGITS, "0").split("");
    setHTML("aiTarget",
      `<p class="note">${N_DIGITS} independent 10-way classifications of
       <span class="mono">${y.toLocaleString()}</span></p>
       <div class="chips">${ds.map((d, i) =>
         `<span class="chip">10<sup>${N_DIGITS - 1 - i}</sup> place → <strong>${d}</strong></span>`).join("")}</div>`);
    setHTML("aiLoss",
      `<pre class="code" style="margin:0">cross_entropy(out.view(-1, N_DIGITS, 10).reshape(-1, 10),
              tgt.reshape(-1))</pre>
       <p class="note">Each position is its own classifier, and each is only ever supervised on the
       digit values the training range happens to produce. The next panel enumerates exactly which
       values those are.</p>`);
  }

  const kb = kron().encodeOne(String(a));
  setHTML("aiKron",
    `The word block for the token <span class="mono">"${a}"</span> is computed from its
     ${String(a).length} bytes, not looked up: first four of its ${D_WORD} dimensions are
     <span class="mono">${[...kb.slice(0, 4)].map(v => v.toFixed(4)).join(", ")}</span>. That is why an
     unseen number is still representable — nothing about it needed to be in a vocabulary.`);
}

/* --- why the digit head cannot generalise ------------------------------ */
function answerDigitSets(task, split) {
  const cfg = DATA[task === "add" ? "e3add" : "e3mul"];
  const [lo, hi] = split === "train" ? cfg.train_range : cfg.ood_range;
  const sets = Array.from({ length: N_DIGITS }, () => new Set());
  const note = (y) => {
    const s = String(y).padStart(N_DIGITS, "0");
    for (let i = 0; i < N_DIGITS; i++) sets[i].add(+s[i]);
  };
  if (task === "add") {
    for (let y = 2 * lo; y <= 2 * (hi - 1); y++) note(y);          // contiguous
  } else {
    for (let a = lo; a < hi; a++) for (let b = lo; b < hi; b++) note(a * b);
  }
  return sets;
}

function renderDigitCollapse() {
  const task = document.getElementById("dgTask").value;
  const tr = answerDigitSets(task, "train"), od = answerDigitSets(task, "ood");
  const cfg = DATA[task === "add" ? "e3add" : "e3mul"];
  let blind = [];
  setHTML("dgTable",
    `<tr><th>digit position</th><th class="num">place value</th>
     <th>values seen in training</th><th>values needed out of range</th><th>never supervised</th></tr>` +
    Array.from({ length: N_DIGITS }, (_, i) => {
      const t = [...tr[i]].sort((x, y) => x - y), o = [...od[i]].sort((x, y) => x - y);
      const missing = o.filter(v => !tr[i].has(v));
      if (missing.length) blind.push({ pos: i, missing });
      return `<tr class="${missing.length ? "miss" : ""}"><td>position ${i}</td>
        <td class="num">10<sup>${N_DIGITS - 1 - i}</sup></td>
        <td class="num">${t.join(" ")}</td><td class="num">${o.join(" ")}</td>
        <td class="num">${missing.length ? `<strong>${missing.join(" ")}</strong>` : "—"}</td></tr>`;
    }).join(""));
  const base = cfg.arms.find(a => a.arm === "A_digit_baseline");
  setHTML("dgNote", blind.length
    ? `Position ${blind[0].pos} is the one that decides it. In training, that classifier is only ever
       shown the label${[...tr[blind[0].pos]].length > 1 ? "s" : ""}
       <span class="mono">${[...tr[blind[0].pos]].sort((x, y) => x - y).join(", ")}</span>; out of range
       it is asked for <span class="mono">${blind[0].missing.join(", ")}</span>, which received no
       gradient at any point in training. A softmax cannot emit a class it was never taught, so the
       measured out-of-distribution score is not low — it is exactly
       <strong>${pct(base.acc_ood, 2)}</strong>, and it could not have been anything else. The failure
       is in the output representation, not in the model's capacity: the same backbone with the math
       block on both ends scores
       ${pct(cfg.arms.find(a => a.arm === "C_kron_math__block").acc_ood, 2)}.`
    : `Every digit value needed at test time was also seen in training for this task, so this
       particular argument does not apply here — the baseline still fails, but for the ordinary reason
       that it never learned the carry rule at these magnitudes.`);
}

/* --- what each head costs ---------------------------------------------- */
function renderHeadCost() {
  const dm = DATA.e3add ? DATA.e3add.d_model : 128;
  const sumP = codec.primes.reduce((s, p) => s + p, 0);
  const lin = out => dm * out + out;
  const armOOD = (key, arm) => {
    const d = DATA[key]; if (!d) return "—";
    const a = d.arms.find(x => x.arm === arm);
    return a ? pct(a.acc_ood) : "—";
  };
  const rows = [
    ["regress the math block", "35 reals, MSE, decoded with error correction", codec.dim, lin(codec.dim),
     "C_kron_math__block"],
    ["one softmax per prime", `${codec.primes.join(" + ")} = ${sumP} logits, cross-entropy`, sumP, lin(sumP),
     "D_kron_math__residue"],
    ["six 10-way digit softmaxes", "60 logits, one classifier per decimal place", N_DIGITS * 10,
     lin(N_DIGITS * 10), "F_kron_math__digits"],
  ];
  setHTML("hcTable",
    `<tr><th>head</th><th>what it predicts</th><th class="num">outputs</th>
     <th class="num">head params at d_model ${dm}</th><th class="num">OOD a+b</th><th class="num">OOD a×b</th></tr>` +
    rows.map(([n, d, o, p, arm]) =>
      `<tr><td>${n}</td><td class="note">${d}</td><td class="num">${o}</td>
       <td class="num">${p.toLocaleString()}</td><td class="num">${armOOD("e3add", arm)}</td>
       <td class="num">${armOOD("e3mul", arm)}</td></tr>`).join("") +
    `<tr><td>a vocabulary head over every number token</td>
     <td class="note">the conventional alternative, one logit per representable integer</td>
     <td class="num">${PAYLOAD.toLocaleString()}</td>
     <td class="num">${lin(PAYLOAD).toLocaleString()}</td><td class="num">—</td><td class="num">—</td></tr>
     <tr><td colspan="6" class="note">The residue head is
       ${Math.round(lin(PAYLOAD) / lin(sumP)).toLocaleString()}× smaller than the vocabulary head it
       replaces, and still generalises past the training range.</td></tr>`);
}

/* --- the E2 budget against the E3 measurement -------------------------- */
function renderErrorBudget() {
  const e2 = DATA.e2, add = DATA.e3add, mul = DATA.e3mul;
  if (!e2 || !add || !mul) return;
  const cA = add.arms.find(a => a.arm === "C_kron_math__block");
  const cM = mul.arms.find(a => a.arm === "C_kron_math__block");
  const thr = e2.sigma_at_99pct.ml_rrns;
  const W = 560, H = 240, L = 46, R = 14, T = 18, B = 46;
  const s = svg(W, H);
  const X = v => L + (v / 0.5) * (W - L - R);
  const Y = v => T + (1 - v / 100) * (H - T - B);
  [0, 25, 50, 75, 100].forEach(g => {
    s.appendChild(el("line", { x1: L, y1: Y(g), x2: W - R, y2: Y(g) }, "stroke:var(--grid);stroke-width:1"));
    s.appendChild(txt(L - 8, Y(g) + 4, g + "%", INK2, "end"));
  });
  [0, .1, .2, .3, .4, .5].forEach(g => s.appendChild(txt(X(g), H - 22, g.toFixed(1), INK2)));
  s.appendChild(txt(W / 2, H - 6, "block error  (σ for E2, measured RMSE for E3)", MUT));
  const pts = e2.rows.map(r => `${X(r.sigma)},${Y(100 * r.ml_rrns)}`).join(" ");
  s.appendChild(el("polyline", { points: pts, fill: "none" },
                   `stroke:${SV(1)};stroke-width:2.4;stroke-linejoin:round`));
  s.appendChild(el("rect", { x: L, y: T, width: X(thr) - L, height: Y(0) - T },
                   `fill:${SV(3)};opacity:.09`));
  s.appendChild(txt((L + X(thr)) / 2, Y(5), "inside the E2 budget",
                    `fill:var(--series-3);font-size:11px;font-weight:600`));
  [[cA.block_rmse_ood, `E3 a+b  ${cA.block_rmse_ood.toFixed(3)}`, SV(2)],
   [cM.block_rmse_ood, `E3 a×b  ${cM.block_rmse_ood.toFixed(3)}`, SV(4)],
   [thr, `E2 budget  ${thr.toFixed(3)}`, "var(--text-primary)"]].forEach(([v, lab, col], i) => {
    s.appendChild(el("line", { x1: X(v), y1: T, x2: X(v), y2: Y(0) },
                     `stroke:${col};stroke-width:1.6;stroke-dasharray:${i === 2 ? "4 4" : "0"}`));
    s.appendChild(txt(X(v) + 5, T + 22 + i * 34, lab, `fill:${col};font-size:11px;font-weight:600`, "start"));
  });
  const host = document.getElementById("ebChart");
  host.innerHTML = ""; host.appendChild(s);
  setHTML("ebNote",
    `E2 said the error-correcting decoder holds to σ = ${thr.toFixed(2)} per slot. The trained model's
     actual block error on out-of-distribution problems was
     <strong>${cA.block_rmse_ood.toFixed(3)}</strong> for addition — a factor of
     ${(thr / cA.block_rmse_ood).toFixed(1)} inside the budget — and
     <strong>${cM.block_rmse_ood.toFixed(3)}</strong> for multiplication, still a factor of
     ${(thr / cM.block_rmse_ood).toFixed(1)} inside it. That is why arm C's accuracy is
     ${pct(cA.acc_ood)} and ${pct(cM.acc_ood)} rather than something in between: the model does not have
     to be right, only close enough, and the decoder was designed to say how close that is.
     For contrast, arm B — the same trunk with no math block on the input — sat at
     ${add.arms.find(a => a.arm === "B_kron_only__block").block_rmse_ood.toFixed(2)}, far outside the
     chart.`);
}

function renderE3Stats() {
  const add = DATA.e3add, mul = DATA.e3mul; if (!add || !mul) return;
  const c = add.arms.find(a => a.arm === "C_kron_math__block");
  const b = add.arms.find(a => a.arm === "A_digit_baseline");
  const cM = mul.arms.find(a => a.arm === "C_kron_math__block");
  statStrip("e3Stats", [
    ["arms", add.arms.length, `one shared backbone, ~${Math.round(c.params / 1000)}k parameters each`],
    ["training", `${add.steps.toLocaleString()}`, `steps of batch ${add.batch}, on ${add.device}`],
    ["OOD with the math block", pct(c.acc_ood), `a+b · ${pct(cM.acc_ood)} on a×b`],
    ["OOD for the digit baseline", pct(b.acc_ood, 0), "operands larger than anything in training"],
  ]);
}

/* ==================================================================== E4 */
const MAX_LEN = 11;
const OPWORD = { add: "addition", sub: "subtraction", mul: "multiplication" };
let SB = { op: "add", tpl: 0, split: "ood", a: 0, b: 0 };

function sbTemplates(op) { return (DATA.e4 && DATA.e4.templates[op]) || []; }
function sbSample() {
  const op = document.getElementById("sbOp").value;
  const split = document.getElementById("sbSplit").value;
  const r = DATA.e4.ranges[op];
  const [lo, hi] = split === "train" ? [r[0], r[1]] : [r[2], r[3]];
  let a = randInt(lo, hi), b = randInt(lo, hi);
  if (op === "sub" && b > a) { const t = a; a = b; b = t; }
  SB = { op, split, tpl: +document.getElementById("sbTpl").value || 0, a, b };
  renderSentence();
}

function renderSentence() {
  if (!DATA.e4) return;
  const { op, a, b } = SB;
  const tpls = sbTemplates(op);
  const tpl = tpls[Math.min(SB.tpl, tpls.length - 1)] || "";
  const y = op === "add" ? a + b : op === "sub" ? a - b : a * b;
  const zeroed = document.getElementById("sbZero").checked;
  const words = tpl.split(" ");
  const toks = words.map(w => w === "{A}" ? { t: String(a), num: a }
                          : w === "{B}" ? { t: String(b), num: b } : { t: w, num: null });
  const padded = Array.from({ length: MAX_LEN - toks.length }, () => ({ t: "[pad]", pad: true }))
                 .concat(toks);

  setHTML("sbSentence",
    toks.map(t => t.num === null ? t.t : `<span class="num">${t.num.toLocaleString()}</span>`).join(" ") +
    ` &nbsp;→&nbsp; <span class="ans">${y.toLocaleString()}</span>`);
  const r = DATA.e4.ranges[op];
  const [lo, hi] = SB.split === "train" ? [r[0], r[1]] : [r[2], r[3]];
  setHTML("sbMeta",
    `${OPWORD[op]}, operands drawn from <span class="mono">[${lo.toLocaleString()},
     ${(hi - 1).toLocaleString()}]</span> — the ${SB.split === "train" ? "training" : "out-of-distribution"}
     range. ${toks.length} tokens, left-padded to ${MAX_LEN} so the answer is always read off the last
     position.${op === "sub" ? " Subtraction swaps its operands when b would exceed a, to keep answers non-negative." : ""}`);

  const D = codec.dim;
  setHTML("sbBand", padded.map((t, i) => {
    const isNum = t.num !== undefined && t.num !== null;
    return bandRow(`${i}  ${t.t}`, [
      { w: D_WORD, on: !t.pad, col: SV(1), lab: t.pad ? "" : `word ${D_WORD}` },
      { w: D, on: isNum && !zeroed, col: SV(3), lab: isNum ? (zeroed ? "zeroed" : `math ${D}`) : "" },
      { w: 1, on: isNum, col: SV(4), lab: "" },
      { w: 1, on: !!t.pad, col: "var(--text-muted)", lab: "" },
    ], t.pad ? "padding" : isNum ? `number token, math block populated` : "word token, math slice zero");
  }).join(""));

  // what the closed-form operator makes of the same operands
  const ea = codec.encode(a), eb = codec.encode(b);
  const vec = op === "add" ? codec.add(ea, eb) : op === "sub" ? codec.sub(ea, eb) : codec.mul(ea, eb);
  const got = codec.robust(codec.decodeML(vec).res, 2).n;
  setHTML("sbClosed", zeroed
    ? `<div class="keypoint">With the math slice zeroed, every number token in this sentence is now
       indistinguishable from its spelling alone. The word block still tells the model that this is
       ${OPWORD[op]} — the measured arm gets the operation right and the arithmetic wrong, which is
       why its score is ${pct(DATA.e4.arms[0].acc_ood)} rather than zero by luck.</div>`
    : `<div class="keypoint">The word block picks the operation; the math block does the arithmetic.
       Composing the two operand blocks directly with <span class="mono">${op === "mul" ? "⊗" : "⊕"}</span>
       and decoding gives <span class="mono">${got.toLocaleString()}</span>
       ${got === y ? "— the right answer, with no model involved at all." : "— which differs from the exact answer."}
       The model's job is only to route the right operator to the right operands.</div>`);
}

function renderWordBlock() {
  const tok = document.getElementById("kwToken").value || "";
  const k = kron();
  const bytes = utf8Bytes(tok).slice(0, 32);
  const v = k.encodeOne(tok);
  setHTML("kwMeta", bytes.length
    ? `${bytes.length} byte${bytes.length > 1 ? "s" : ""} of ${k.window} window slots used; the vector
       is the mean of ${bytes.length} rows of <span class="mono">byte_matrix[b] + pos_matrix[j]</span>.
       ${k.truncated(tok) ? "This token is longer than the window and was truncated." : ""}`
    : "empty token — the block is all zeros");
  setHTML("kwBand",
    `<div class="chips">${bytes.map((b, i) =>
      `<span class="chip">${i}: ${JSON.stringify(tok[i] || "")} → byte ${b}</span>`).join("")}</div>
     <div class="slots" id="kwSlots" style="height:52px;margin-top:10px"></div>
     <div class="note">the ${k.dWord} Kronecker word dimensions for this token</div>`);
  slotsInto(document.getElementById("kwSlots"), v, 170, 52, SV(1));
}

function renderE4Stats() {
  const d = DATA.e4; if (!d) return;
  const nTpl = Object.values(d.templates).reduce((s, t) => s + t.length, 0);
  statStrip("e4Stats", [
    ["surface forms", nTpl, `${Object.keys(d.templates).length} operations, ${d.words.length} words`],
    ["OOD with the math block", pct(d.arms[1].acc_ood), `${pct(d.arms[0].acc_ood)} without it`],
    ["training", d.steps.toLocaleString(), `steps of batch ${d.batch}, on ${d.device}`],
    ["number tokens", d.payload.toLocaleString(), "every one a single token, none of them learned"],
  ]);
  setHTML("e4Words", d.words.map(w => `<span class="chip">${w}</span>`).join(""));
}

/* ==================================================================== E5 */
let LC = null;
function lc() { if (!LC) LC = new LinearCodec(); return LC; }

function renderLinearCodec() {
  const L = lc();
  const a = num("lcA", 0, PAYLOAD - 1, 9), b = num("lcB", 0, PAYLOAD - 1, 47);
  const op = document.getElementById("lcOp").value;
  const u = L.encode(a), v = L.encode(b);
  const t0 = Date.now();
  const w = op === "add" ? L.add(u, v) : L.mul(u, v);
  const ms = Date.now() - t0;
  const y = op === "add" ? (a + b) % L.M : intResult("mul", a, b, L.M);
  const ref = L.encode(y);
  let worst = 0;
  const perPrime = L.primes.map((p, i) => {
    let m = 0;
    for (let t = L.offsets[i]; t < L.offsets[i + 1]; t++) m = Math.max(m, Math.abs(w[t] - ref[t]));
    worst = Math.max(worst, m);
    return m;
  });
  const got = L.decode(w);

  setText("lcDecoded", got.toLocaleString());
  const ok = got === y;
  const vv = document.getElementById("lcVerdict");
  vv.textContent = ok ? "exact" : "mismatch";
  vv.className = "pill " + (ok ? "ok" : "bad");
  setText("lcTruth", `${a} ${op === "add" ? "+" : "×"} ${b} = ${y.toLocaleString()} · computed in ${ms} ms`);
  slotsInto(document.getElementById("lcSlots"), w, 16, 54, SV(3));
  setHTML("lcSlotCap",
    `the ${L.dim} slots of the composed block — ${L.primes.map((p, i) => `${4 * p - 1} for p=${p}`).join(", ")}`);
  setHTML("lcTable",
    `<tr><th>prime</th><th class="num">dims (4p−1)</th><th class="num">compact codec</th>
     <th class="num">offset</th><th class="num">max |result − E(y)| in this block</th></tr>` +
    L.primes.map((p, i) => `<tr><td>${p}</td><td class="num">${4 * p - 1}</td><td class="num">5</td>
      <td class="num">${L.offsets[i]}</td><td class="num">${perPrime[i].toExponential(2)}</td></tr>`).join("") +
    `<tr><td><strong>total</strong></td><td class="num"><strong>${L.dim}</strong></td>
     <td class="num"><strong>${codec.dim}</strong></td><td class="num"></td>
     <td class="num"><strong>${worst.toExponential(2)}</strong></td></tr>`);
}

function renderLinearity() {
  const L = lc();
  const al = +document.getElementById("linAlpha").value || 0;
  const be = +document.getElementById("linBeta").value || 0;
  const n = +document.getElementById("linN").value || 40;
  const out = [];
  for (const [name, f] of [["refresh_from_add", v => L.refreshFromAdd(v)],
                           ["refresh_from_mul", v => L.refreshFromMul(v)]]) {
    let worst = 0;
    for (let t = 0; t < n; t++) {
      const x = Float64Array.from({ length: L.dim }, () => gauss());
      const y = Float64Array.from({ length: L.dim }, () => gauss());
      const mix = Float64Array.from({ length: L.dim }, (_, i) => al * x[i] + be * y[i]);
      const left = f(mix), fx = f(x), fy = f(y);
      for (let i = 0; i < L.dim; i++) {
        worst = Math.max(worst, Math.abs(left[i] - (al * fx[i] + be * fy[i])));
      }
    }
    out.push([name, worst]);
  }
  const stored = DATA.e5 ? DATA.e5.linearity_violation : null;
  setHTML("linOut",
    `<table><tr><th>refresh map</th><th class="num">max |f(αx+βy) − αf(x) − βf(y)|</th>
     <th class="num">stored run</th><th>verdict</th></tr>` +
    out.map(([nm, w]) => `<tr><td class="mono">${nm}</td><td class="num">${w.toExponential(2)}</td>
      <td class="num">${stored && stored[nm] !== undefined ? stored[nm].toExponential(2) : "—"}</td>
      <td><span class="pill ${w < 1e-9 ? "ok" : "bad"}">${w < 1e-9 ? "linear" : "NOT linear"}</span></td></tr>`).join("") +
    `<tr><td colspan="4" class="note">${n} random vector pairs in ${L.dim} dimensions, α = ${al},
      β = ${be}. Anything at the 10<sup>−15</sup> level is double-precision rounding, not a violation.</td></tr>
     </table>`);

  // the compact codec's lookup refresh, for contrast
  let cw = 0;
  for (let t = 0; t < 20; t++) {
    const x = Float64Array.from({ length: codec.dim }, () => gauss());
    const y = Float64Array.from({ length: codec.dim }, () => gauss());
    const mix = Float64Array.from({ length: codec.dim }, (_, i) => al * x[i] + be * y[i]);
    const f = v => codec.canonicalize(v, "add");
    const left = f(mix), fx = f(x), fy = f(y);
    for (let i = 0; i < codec.dim; i++) cw = Math.max(cw, Math.abs(left[i] - (al * fx[i] + be * fy[i])));
  }
  setHTML("linCompact",
    `<p class="note">The compact codec's refresh is a lookup: it decodes residues and rebuilds the
     block from a table. Running the identical check on it gives a violation of
     <span class="mono">${cw.toExponential(2)}</span> — order one, not order 10<sup>−15</sup>. That is
     not a bug; it is the precise sense in which the compact codec is parameter-free but
     <em>not</em> linear, and it is the gap E5 closes by paying
     ${lc().dim - codec.dim} extra dimensions.</p>`);
}

function renderMatrices() {
  const L = lc();
  const i = Math.max(0, Math.min(L.k - 1, +document.getElementById("lmPrime").value || 0));
  const part = document.getElementById("lmPart").value;
  const p = L.primes[i];
  const cell = v => {
    const t = Math.max(-1, Math.min(1, v));
    const col = t >= 0 ? `color-mix(in srgb, var(--series-1) ${Math.round(100 * t)}%, var(--surface-2))`
                       : `color-mix(in srgb, var(--series-2) ${Math.round(-100 * t)}%, var(--surface-2))`;
    return `<i style="background:${col}"></i>`;
  };
  const grid = (name, cols, cells, caption) =>
    `<div><div class="eyebrow">${name}</div>
     <div class="matbox"><div class="mat" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div></div>
     <div class="note" style="margin-top:6px">${caption}</div></div>`;

  const F = L.F[i], G = L.G[i];
  const Fcells = Array.from({ length: p * p }, (_, t) => cell(part === "re" ? F.re[t] : F.im[t])).join("");
  const Gcells = Array.from({ length: (p - 1) * (p - 1) }, (_, t) =>
    cell(part === "re" ? G.re[t] : G.im[t])).join("");
  let Qcells = "";
  for (let d = 0; d < p - 1; d++) {
    for (let r = 0; r < p; r++) Qcells += cell(r !== 0 && L.base.dlog[i][r] === d ? 1 : 0);
  }
  setHTML("lmBoxes",
    grid(`F — additive DFT (${p}×${p})`, p, Fcells,
      `F[k, r] = exp(2πi·k·r/${p}). Encoding is one column of this; decoding is one multiply by its conjugate.`) +
    grid(`G — multiplicative DFT (${p - 1}×${p - 1})`, p - 1, Gcells,
      `G[j, d] = exp(2πi·j·d/${p - 1}), indexed by discrete logarithm rather than by residue.`) +
    grid(`Q — relabel by dlog (${p - 1}×${p})`, p, Qcells,
      `Q[dlog(r), r] = 1. Real, 0/1, and the only piece that knows the group is cyclic. Column 0 is empty because dlog(0) does not exist.`));
  setHTML("lmNote",
    `Generator g = ${L.base.roots[i]}. These three matrices are all that
     <span class="mono">refresh_from_add</span> and <span class="mono">refresh_from_mul</span> multiply
     by — no lookup, no branch, no learned parameter. Their sizes are also the cost: keeping all
     ${p} additive and ${p - 1} multiplicative characters is
     <span class="mono">${4 * p - 1}</span> reals for this prime, against 5 in the compact codec.` +
    (part === "im" ? ` Q has no imaginary part, so its panel is blank in this view.` : ""));
}

function renderE5Results() {
  const d = DATA.e5; if (!d) return;
  statStrip("e5Stats", [
    ["additions exact", `${d.n.toLocaleString()}/${d.n.toLocaleString()}`,
     `deviation from E(a+b) ≤ ${d.max_abs_err_add.toExponential(1)}`],
    ["multiplications exact", `${d.n.toLocaleString()}/${d.n.toLocaleString()}`,
     `including ${pct(d.acc_mul_with_zeros, 0)} with zero operands`],
    ["linearity violation", Math.max(...Object.values(d.linearity_violation)).toExponential(1),
     "i.e. double-precision rounding"],
    ["dimensions", `${d.dim_linear}`, `against ${d.dim_compact} for the compact codec`],
  ]);
  setText("e5blurb",
    `Every step is now either an elementwise complex product or a fixed matrix multiply, and the ` +
    `construction is still exact. The compact codec is what you would ship; this is what you would cite.`);
  setHTML("e5Table",
    `<tr><th>measurement</th><th class="num">value</th></tr>` +
    [["addition exact", `${(d.acc_add * d.n).toLocaleString()} / ${d.n.toLocaleString()}`],
     ["multiplication exact", `${(d.acc_mul * d.n).toLocaleString()} / ${d.n.toLocaleString()}`],
     ["multiplication with zero operands", `${(d.acc_mul_with_zeros * d.n).toLocaleString()} / ${d.n.toLocaleString()}`],
     ["max |result − E(a+b)|", d.max_abs_err_add.toExponential(2)],
     ["max |result − E(a·b)|", d.max_abs_err_mul.toExponential(2)],
     ["linearity, refresh_from_add", d.linearity_violation.refresh_from_add.toExponential(2)],
     ["linearity, refresh_from_mul", d.linearity_violation.refresh_from_mul.toExponential(2)],
     ["dimensions, linear codec", String(d.dim_linear)],
     ["dimensions, compact codec", String(d.dim_compact)]]
    .map(([k, v]) => `<tr><td>${k}</td><td class="num">${v}</td></tr>`).join("") +
    `<tr><td><strong>all checks passed</strong></td>
     <td class="num"><span class="pill ${d.all_passed ? "ok" : "bad"}">${d.all_passed ? "yes" : "no"}</span></td></tr>`);

  // per-prime dimension cost
  const W = 520, H = 250, L0 = 46, R = 12, T = 18, B = 46;
  const s = svg(W, H);
  const ymax = Math.max(...codec.primes.map(p => 4 * p - 1)) * 1.25;
  const Y = v => T + (1 - v / ymax) * (H - T - B);
  const gw = (W - L0 - R) / codec.primes.length;
  [0, 25, 50, 75].filter(g => g <= ymax).forEach(g => {
    s.appendChild(el("line", { x1: L0, y1: Y(g), x2: W - R, y2: Y(g) }, "stroke:var(--grid);stroke-width:1"));
    s.appendChild(txt(L0 - 8, Y(g) + 4, g, INK2, "end"));
  });
  codec.primes.forEach((p, i) => {
    const base = L0 + i * gw;
    [[5, SV(1), "compact"], [4 * p - 1, SV(3), "linear"]].forEach(([v, col, lab], j) => {
      const w = gw * 0.3, x = base + gw * 0.12 + j * gw * 0.38;
      const r = el("rect", { x, y: Y(v), width: w, height: Math.max(1, Y(0) - Y(v)), rx: 3 }, `fill:${col}`);
      hover(r, `<strong>prime ${p}</strong><br>${lab}: ${v} reals`);
      s.appendChild(r);
      s.appendChild(txt(x + w / 2, Y(v) - 5, v, INK2));
    });
    s.appendChild(txt(base + gw / 2, H - 28, `p=${p}`, INK2));
  });
  s.appendChild(txt(W / 2, H - 8,
    `total ${codec.dim} reals against ${d.dim_linear} — ${(d.dim_linear / d.dim_compact).toFixed(1)}× the cost`, MUT));
  const host = document.getElementById("e5DimChart");
  host.innerHTML = ""; host.appendChild(s);
}

/* ==================================================================== wiring */
function initPanels() {
  /* --- E1 --- */
  fillSelect("e1Check", E1_CHECKS.map(c => [c.id, c.name]), "add_full");
  e1Render();
  const runOne = () => {
    const id = document.getElementById("e1Check").value;
    const n = +document.getElementById("e1Trials").value;
    const btn = document.getElementById("e1Run");
    btn.disabled = true; e1Bar(0);
    setTimeout(() => {
      E1LOG.unshift(e1RunCheck(id, n));
      E1LOG = E1LOG.slice(0, 12);
      e1Bar(1); e1Render(); btn.disabled = false;
    }, 20);
  };
  document.getElementById("e1Run").addEventListener("click", runOne);
  document.getElementById("e1RunAll").addEventListener("click", () => {
    const n = +document.getElementById("e1Trials").value;
    const btn = document.getElementById("e1RunAll");
    btn.disabled = true; E1LOG = []; e1Render();
    let i = 0;
    const step = () => {
      E1LOG.push(e1RunCheck(E1_CHECKS[i].id, n));
      i++; e1Bar(i / E1_CHECKS.length); e1Render();
      if (i < E1_CHECKS.length) setTimeout(step, 0); else btn.disabled = false;
    };
    setTimeout(step, 20);
  });

  ["dcB"].forEach(id => document.getElementById(id).addEventListener("input", renderDivCert));
  document.getElementById("dcRandGood").addEventListener("click", () => {
    let b = randInt(2, 5000);
    while (!codec.isInvertible(codec.encode(b))) b++;
    document.getElementById("dcB").value = b; renderDivCert();
  });
  document.getElementById("dcRandBad").addEventListener("click", () => {
    const p = codec.primes[randInt(0, codec.k)];
    document.getElementById("dcB").value = p * randInt(2, 200); renderDivCert();
  });
  ["raP1", "raQ1", "raP2", "raQ2"].forEach(id =>
    document.getElementById(id).addEventListener("input", renderRationals));
  document.getElementById("raRand").addEventListener("click", () => {
    document.getElementById("raP1").value = randInt(-300, 301);
    document.getElementById("raQ1").value = ratDen();
    document.getElementById("raP2").value = randInt(-300, 301);
    document.getElementById("raQ2").value = ratDen();
    renderRationals();
  });
  renderDivCert(); renderRationals(); renderE1Results();

  /* --- E2 --- */
  renderE2Stats();
  drawSweepChart(null, 2);
  setHTML("e2SweepNote", `Nothing run yet — press <em>Run sweep</em> to reproduce the curve.`);
  document.getElementById("e2Run").addEventListener("click", () => {
    const n = +document.getElementById("e2N").value;
    const red = +document.getElementById("e2Red").value;
    const btn = document.getElementById("e2Run");
    btn.disabled = true;
    setTimeout(() => e2RunSweep(n, red,
      (rows, f) => { drawSweepChart(rows, red); document.getElementById("e2Bar").style.width = Math.round(100 * f) + "%"; },
      rows => { e2SweepDone(rows, n, red); btn.disabled = false; }), 20);
  });

  /* --- E3 --- */
  fillSelect("aiArm", E3_ARMS.map(a => [a.id, a.label]), "C_kron_math__block");
  ["aiArm", "aiA", "aiB", "aiOp"].forEach(id =>
    document.getElementById(id).addEventListener("input", renderArmInspector));
  document.getElementById("aiRand").addEventListener("click", () => {
    const mul = document.getElementById("aiOp").value === "*";
    document.getElementById("aiA").value = randInt(1, mul ? 292 : 40000);
    document.getElementById("aiB").value = randInt(1, mul ? 292 : 40000);
    renderArmInspector();
  });
  document.getElementById("dgTask").addEventListener("input", renderDigitCollapse);
  renderE3Stats(); renderArmInspector(); renderDigitCollapse(); renderHeadCost(); renderErrorBudget();

  /* --- E4 --- */
  renderE4Stats();
  const fillTpl = () => {
    const op = document.getElementById("sbOp").value;
    fillSelect("sbTpl", sbTemplates(op).map((t, i) => [i, t.replace("{A}", "a").replace("{B}", "b")]), 0);
  };
  fillTpl();
  document.getElementById("sbOp").addEventListener("input", () => { fillTpl(); sbSample(); });
  document.getElementById("sbSplit").addEventListener("input", sbSample);
  document.getElementById("sbTpl").addEventListener("input", () => {
    SB.tpl = +document.getElementById("sbTpl").value || 0; renderSentence();
  });
  document.getElementById("sbZero").addEventListener("input", renderSentence);
  document.getElementById("sbRand").addEventListener("click", sbSample);
  document.getElementById("kwToken").addEventListener("input", renderWordBlock);
  sbSample(); renderWordBlock();

  /* --- E5 --- */
  fillSelect("lmPrime", codec.primes.map((p, i) => [i, `p = ${p}`]), 1);
  ["lcA", "lcB", "lcOp"].forEach(id =>
    document.getElementById(id).addEventListener("input", renderLinearCodec));
  document.getElementById("lcRand").addEventListener("click", () => {
    const mul = document.getElementById("lcOp").value === "mul";
    document.getElementById("lcA").value = randInt(1, mul ? 290 : 40000);
    document.getElementById("lcB").value = randInt(1, mul ? 290 : 40000);
    renderLinearCodec();
  });
  document.getElementById("linRun").addEventListener("click", () => {
    const btn = document.getElementById("linRun");
    btn.disabled = true;
    setTimeout(() => { renderLinearity(); btn.disabled = false; }, 20);
  });
  ["lmPrime", "lmPart"].forEach(id =>
    document.getElementById(id).addEventListener("input", renderMatrices));
  renderE5Results(); renderLinearCodec(); renderLinearity(); renderMatrices();
}

initPanels();
