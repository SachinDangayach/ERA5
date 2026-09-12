/* UI layer, part 1: shared helpers, the explainer tab, and the panels that
   were already here.  Codec / LinearCodec / KroneckerWordBlock / DATA are all
   in scope (inlined by build.py).  Experiment panels live in panels.js. */
const codec = new Codec();
const PAYLOAD = codec.payload(2);
const tip = document.getElementById("tip");
const SV = n => `var(--series-${n})`;
const ALL_IDX = [...Array(codec.k).keys()];

/* ---------- tiny SVG helpers ---------------------------------------- */
const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs = {}, style = "") {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (style) n.setAttribute("style", style);
  return n;
}
function svg(w, h) {
  const s = el("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%",
                        preserveAspectRatio: "xMidYMid meet" });
  s.style.display = "block";
  s.style.overflow = "visible";
  return s;
}
function txt(x, y, s, style = "", anchor = "middle") {
  const t = el("text", { x, y, "text-anchor": anchor }, style);
  t.textContent = s;
  return t;
}
function hover(node, html) {
  node.style.cursor = "default";
  node.addEventListener("pointerenter", () => {
    tip.innerHTML = html; tip.style.opacity = 1;
  });
  node.addEventListener("pointermove", e => {
    tip.style.left = Math.min(e.clientX + 14, innerWidth - 300) + "px";
    tip.style.top = (e.clientY - 12) + "px";
  });
  node.addEventListener("pointerleave", () => { tip.style.opacity = 0; });
}
const INK = "fill:var(--text-primary)";
const INK2 = "fill:var(--text-secondary);font-size:11px";
const MUT = "fill:var(--text-muted);font-size:10.5px";

function setHTML(id, html) { const n = document.getElementById(id); if (n) n.innerHTML = html; }
function setText(id, s) { const n = document.getElementById(id); if (n) n.textContent = s; }
function num(id, lo, hi, dflt) {
  const n = document.getElementById(id);
  const v = n ? +n.value : dflt;
  return Math.max(lo, Math.min(Number.isFinite(v) ? v : dflt, hi));
}
function pct(x, d = 2) { return (100 * x).toFixed(d) + "%"; }
function statStrip(id, items) {
  setHTML(id, items.map(([k, v, d]) =>
    `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>
     <div class="d">${d || ""}</div></div>`).join(""));
}

/* ---------- dials ----------------------------------------------------- */
function dial(n, p, colorVar) { return dialAt(n % p, p, colorVar); }

function dialAt(r, p, colorVar) {
  const ang = 2 * Math.PI * r / p;
  const s = svg(64, 64); s.setAttribute("width", 64); s.setAttribute("height", 64);
  s.appendChild(el("circle", { cx: 32, cy: 32, r: 26, fill: "none" },
                   "stroke:var(--grid);stroke-width:1.4"));
  for (let j = 0; j < p; j++) {
    const a = 2 * Math.PI * j / p;
    s.appendChild(el("circle", { cx: 32 + 26 * Math.cos(a), cy: 32 - 26 * Math.sin(a), r: 1.5 },
                     "fill:var(--text-muted);opacity:.55"));
  }
  const g = el("g", { class: "hand" });
  g.style.transform = `rotate(${-ang * 180 / Math.PI}deg)`;
  g.appendChild(el("line", { x1: 32, y1: 32, x2: 56, y2: 32 },
                   `stroke:${colorVar};stroke-width:2.4;stroke-linecap:round`));
  g.appendChild(el("circle", { cx: 56, cy: 32, r: 4.4 },
                   `fill:${colorVar};stroke:var(--surface-1);stroke-width:2`));
  s.appendChild(g);
  return s;
}

function renderDials() {
  const a = num("opA", 0, PAYLOAD - 1, 9), b = num("opB", 0, PAYLOAD - 1, 47);
  const op = document.getElementById("op").value;
  const ea = codec.encode(a), eb = codec.encode(b);
  const combined = op === "add" ? codec.add(ea, eb) : codec.mul(ea, eb);
  const got = codec.robust(codec.decodeML(combined).res).n;
  const want = op === "add" ? (a + b) % codec.M : (a * b) % codec.M;

  const host = document.getElementById("dials");
  host.innerHTML = "";
  const rows = [[a, `E(${a})`, SV(1)], [b, `E(${b})`, SV(1)],
                [got, `E(${a}) ${op === "add" ? "⊕" : "⊗"} E(${b})`, SV(3)]];
  rows.forEach(([n, label, col]) => {
    const row = document.createElement("div"); row.className = "dialrow";
    const lab = document.createElement("div"); lab.className = "rowlab";
    lab.innerHTML = `<strong>${label}</strong>`;
    row.appendChild(lab);
    codec.primes.forEach(p => {
      const cell = document.createElement("div"); cell.className = "dial";
      cell.appendChild(dial(n, p, col));
      const cap = document.createElement("div"); cap.className = "cap mono";
      cap.textContent = `${p}→${n % p}`;
      cell.appendChild(cap);
      hover(cell, `<strong>prime ${p}</strong><br>${n} mod ${p} = ${n % p}<br>
                   angle ${(360 * (n % p) / p).toFixed(1)}°`);
      row.appendChild(cell);
    });
    host.appendChild(row);
  });

  setText("decoded", got.toLocaleString());
  const ok = got === want;
  const v = document.getElementById("verdict");
  v.textContent = ok ? "exact" : "wrapped mod M";
  v.className = "pill " + (ok ? "ok" : "bad");
  setText("truth", `${a} ${op === "add" ? "+" : "×"} ${b} = ${want.toLocaleString()}` +
    (want >= PAYLOAD ? "  (beyond the 85,085 payload — pick more primes)" : ""));
}

/* ---------- the explainer tab ----------------------------------------- */
const EX = {};

function fillPrimeSelect() {
  const sel = document.getElementById("exPrime");
  sel.innerHTML = "";
  codec.primes.forEach((p, i) => {
    const o = document.createElement("option");
    o.value = String(i); o.textContent = `p = ${p}`;
    sel.appendChild(o);
  });
  sel.value = "1";                       // p = 7 reads nicely: small but not trivial
}

function renderExplainer() {
  const a = num("exA", 0, 84999, 9), b = num("exB", 0, 84999, 47);
  const i = Math.min(codec.k - 1, Math.max(0, +document.getElementById("exPrime").value || 0));
  const p = codec.primes[i];

  /* --- step 1: the two lattices for the focused prime ------------------ */
  const host = document.getElementById("exDials");
  host.innerHTML = "";
  const rows = [
    { lab: `additive, mod ${p}`, mod: p, col: SV(1),
      items: [[a, a % p], [b, b % p], [(a + b) % codec.M, (a + b) % p]],
      names: [`α(${a})`, `α(${b})`, `α(${a}+${b})`] },
    { lab: `multiplicative, mod ${p - 1}`, mod: p - 1, col: SV(2),
      items: [[a, codec.dlog[i][a % p]], [b, codec.dlog[i][b % p]],
              [(a * b) % codec.M, codec.dlog[i][(a * b) % p]]],
      names: [`μ(${a})`, `μ(${b})`, `μ(${a}×${b})`] },
  ];
  rows.forEach(r => {
    const row = document.createElement("div"); row.className = "dialrow";
    const lab = document.createElement("div"); lab.className = "rowlab";
    lab.innerHTML = `<strong>${r.lab}</strong>`;
    row.appendChild(lab);
    r.items.forEach(([n, idx], j) => {
      const cell = document.createElement("div"); cell.className = "dial";
      const undef = idx < 0;
      cell.appendChild(dialAt(undef ? 0 : idx, r.mod, undef ? "var(--text-muted)" : r.col));
      const cap = document.createElement("div"); cap.className = "cap mono";
      cap.textContent = undef ? "undefined" : `${r.names[j]}=${idx}`;
      cell.appendChild(cap);
      hover(cell, undef
        ? `<strong>${n} ≡ 0 (mod ${p})</strong><br>no discrete logarithm exists here —<br>this is what the zero flag covers`
        : `<strong>${r.names[j]}</strong><br>lattice point ${idx} of ${r.mod}<br>angle ${(360 * idx / r.mod).toFixed(1)}°`);
      row.appendChild(cell);
    });
    host.appendChild(row);
  });
  const dm = codec.dlog[i][(a * b) % p];
  setHTML("exDialCap",
    `The third dial in each row is the elementwise complex product of the first two. Top row:
     ${a % p} + ${b % p} ≡ ${(a + b) % p} (mod ${p}). Bottom row: ` +
    (dm < 0
      ? `${a}×${b} ≡ 0 (mod ${p}), so there is no exponent to land on — the zero flag carries it instead.`
      : `the exponents add instead, so ${a}×${b} lands on lattice point ${dm} of ${p - 1}.`));

  /* --- step 2: CRT across every prime --------------------------------- */
  const sum = (a + b) % codec.M;
  setHTML("exAddTable",
    `<tr><th>prime p</th><th class="num">${a} mod p</th><th class="num">${b} mod p</th>
     <th class="num">sum</th><th class="num">sum mod p</th><th class="num">${sum} mod p</th><th>agree</th></tr>` +
    codec.primes.map(q => {
      const ra = a % q, rb = b % q, ok = (ra + rb) % q === sum % q;
      return `<tr class="${ok ? "" : "miss"}"><td>${q}</td><td class="num">${ra}</td>
        <td class="num">${rb}</td><td class="num">${ra + rb}</td>
        <td class="num"><strong>${(ra + rb) % q}</strong></td><td class="num">${sum % q}</td>
        <td>${ok ? "yes" : "no"}</td></tr>`;
    }).join("") +
    `<tr><td colspan="5"><strong>CRT reassembles</strong></td>
     <td class="num" colspan="2"><strong>${sum.toLocaleString()}</strong></td></tr>`);

  /* --- step 3: discrete logs ------------------------------------------- */
  const prod = (a * b) % codec.M;
  setHTML("exMulTable",
    `<tr><th>prime p</th><th class="num">g</th><th class="num">dlog(${a})</th>
     <th class="num">dlog(${b})</th><th class="num">sum mod p−1</th>
     <th class="num">g^that</th><th class="num">${prod} mod p</th><th>agree</th></tr>` +
    codec.primes.map((q, k) => {
      const ra = a % q, rb = b % q, tru = prod % q;
      if (ra === 0 || rb === 0) {
        return `<tr><td>${q}</td><td class="num">${codec.roots[k]}</td>
          <td class="num" colspan="4" style="text-align:center;color:var(--text-muted)">
          an operand is 0 mod ${q} — no discrete log; the zero flag handles it</td>
          <td class="num">${tru}</td><td>via flag</td></tr>`;
      }
      const da = codec.dlog[k][ra], db = codec.dlog[k][rb];
      const ds = (da + db) % (q - 1), back = codec.exp[k][ds], ok = back === tru;
      return `<tr class="${ok ? "" : "miss"}"><td>${q}</td><td class="num">${codec.roots[k]}</td>
        <td class="num">${da}</td><td class="num">${db}</td><td class="num">${ds}</td>
        <td class="num"><strong>${back}</strong></td><td class="num">${tru}</td>
        <td>${ok ? "yes" : "no"}</td></tr>`;
    }).join("") +
    `<tr><td colspan="6"><strong>CRT reassembles</strong></td>
     <td class="num" colspan="2"><strong>${prod.toLocaleString()}</strong></td></tr>`);

  /* --- step 4: which zero flags are lit -------------------------------- */
  const za = codec.primes.filter(q => a % q === 0), zb = codec.primes.filter(q => b % q === 0);
  setHTML("exZero",
    `For these operands the flags are set on: <span class="mono">${a}</span> →
     ${za.length ? za.join(", ") : "none"}; <span class="mono">${b}</span> →
     ${zb.length ? zb.join(", ") : "none"}.
     ${za.length || zb.length
       ? "Those prime channels take the multiplicative answer from the flag rather than from a discrete log."
       : "With no flags lit, every channel of both operands carries a well-defined discrete logarithm."}`);

  /* --- the block itself ------------------------------------------------ */
  const vec = codec.encode(a);
  setHTML("exBlock",
    `<tr><th>prime</th><th class="num">a mod p</th><th class="num">cos α</th><th class="num">sin α</th>
     <th class="num">cos μ</th><th class="num">sin μ</th><th class="num">zero</th></tr>` +
    codec.primes.map((q, k) => {
      const o = k * 5;
      const cells = [0, 1, 2, 3, 4].map(j =>
        `<td class="num">${vec[o + j].toFixed(4)}</td>`).join("");
      return `<tr><td>${q}</td><td class="num">${a % q}</td>${cells}</tr>`;
    }).join("") +
    `<tr><td colspan="6"><strong>35 numbers total</strong></td>
     <td class="num">0.43% of an 8096-wide model</td></tr>`);

  renderExCompare();
}

/* --- why phases, and not one number --------------------------------- */
const DIGIT_SLOTS = 8;
function exSeedNoise(n) {
  EX.n = n;
  EX.draw = {
    scalar: [gauss()],
    digits: Array.from({ length: DIGIT_SLOTS }, () => gauss()),
    onehot: Array.from({ length: DIGIT_SLOTS * 10 }, () => gauss()),
    phases: Array.from({ length: codec.dim }, () => gauss()),
  };
}
function exResampleNoise() {
  exSeedNoise(Math.floor(Math.random() * codec.payload(2)));
  renderExCompare();
}

function renderExCompare() {
  if (!EX.draw) return;
  const sigma = +document.getElementById("exSigma").value;
  setText("exSigmaVal", sigma.toFixed(3));
  setText("exNoiseN", EX.n.toLocaleString());
  const n = EX.n;

  // 1. one scalar, normalised into [0, 1]
  const sv = n / codec.M + sigma * EX.draw.scalar[0];
  const scalarOut = Math.max(0, Math.round(sv * codec.M));

  // 2. base-10 digits, each slot in [0, 1], rounded on decode
  const ds = String(n).padStart(DIGIT_SLOTS, "0").split("").map(Number);
  let digitOut = 0;
  ds.forEach((d, j) => {
    const v = d / 9 + sigma * EX.draw.digits[j];
    digitOut = digitOut * 10 + Math.min(9, Math.max(0, Math.round(v * 9)));
  });

  // 3. one-hot digits -- the fair robust baseline: it snaps just as hard,
  //    but it costs 10 slots per digit and still cannot add without carries
  let onehotOut = 0;
  ds.forEach((d, j) => {
    let best = -Infinity, arg = 0;
    for (let k = 0; k < 10; k++) {
      const v = (k === d ? 1 : 0) + sigma * EX.draw.onehot[j * 10 + k];
      if (v > best) { best = v; arg = k; }
    }
    onehotOut = onehotOut * 10 + arg;
  });

  // 4. the residue-phase block
  const clean = codec.encode(n);
  const noisy = Float64Array.from(clean, (v, k) => v + sigma * EX.draw.phases[k]);
  const phaseOut = codec.robust(codec.decodeML(noisy).res, 2).n;

  const rows = [
    { name: "one scalar, n / M", slots: 1, got: scalarOut, carry: "yes" },
    { name: "base-10 digits, one slot each", slots: DIGIT_SLOTS, got: digitOut,
      carry: "no — needs carries" },
    { name: "base-10 digits, one-hot", slots: DIGIT_SLOTS * 10, got: onehotOut,
      carry: "no — needs carries" },
    { name: "residue phases (this work)", slots: codec.dim, got: phaseOut, carry: "yes" },
  ];
  setHTML("exCompare",
    `<tr><th>encoding</th><th class="num">slots</th><th class="num">decoded at σ=${sigma.toFixed(3)}</th>
     <th class="num">error</th><th>exact</th><th>“+” without carries</th></tr>` +
    rows.map(r => {
      const ok = r.got === n;
      return `<tr class="${ok ? "" : "miss"}"><td>${r.name}</td><td class="num">${r.slots}</td>
        <td class="num">${r.got.toLocaleString()}</td>
        <td class="num">${ok ? "0" : (r.got - n).toLocaleString()}</td>
        <td><span class="pill ${ok ? "ok" : "bad"}">${ok ? "yes" : "no"}</span></td>
        <td>${r.carry}</td></tr>`;
    }).join(""));
  setHTML("exCompareNote",
    `Read the last column, not just the noise column. The single scalar is precise nowhere — one bad
     slot and the answer is off by hundreds of thousands. The one-hot digit row is included to keep
     this honest: it snaps <em>just as hard</em> as the phase block, so robustness alone is not the
     argument. It costs ${DIGIT_SLOTS * 10} slots against 35, and — decisively — neither digit
     encoding can add without carries, a sequential non-local computation. Residues add componentwise
     in one elementwise product, at any magnitude. That is the property the whole design is buying,
     and the digit baseline's collapse outside its training range in E3 is what it costs not to
     have it.`);
}

/* --- the static-ish cards, filled from the measured results ---------- */
function renderExFromData() {
  const e2 = DATA.e2, e5 = DATA.e5, a = DATA.e3add, m = DATA.e3mul;
  if (e2) {
    const t = e2.sigma_at_99pct;
    setHTML("exDecode",
      `<tr><th>decoder</th><th>idea</th><th class="num">largest σ at 99% recovery</th></tr>` +
      [["phase-only CRT", "read one angle per prime, then CRT", t.phase_only],
       ["nearest codeword (ML)", "pick the nearest of the p legal five-slot patterns", t.ml],
       ["ML + error correction", "rebuild from every drop-one prime subset, keep the most consistent", t.ml_rrns]]
      .map(([n, d, v], k) => `<tr><td>${k === 2 ? "<strong>" + n + "</strong>" : n}</td>
        <td class="note">${d}</td><td class="num"><strong>${v.toFixed(3)}</strong></td></tr>`).join(""));
  }
  if (e5) {
    setHTML("exGlue",
      `It can. Store the <em>full</em> character basis per prime instead of one harmonic — the additive
       characters are the DFT of the residue indicator over ℤ<sub>p</sub>, the multiplicative characters
       are the DFT of the same indicator over ℤ<sub>p−1</sub> after relabelling by discrete log — and
       both changes of basis become fixed unitary matrices. Verified in E5: addition and
       multiplication both ${e5.n.toLocaleString()}/${e5.n.toLocaleString()} exact, and the refresh maps
       satisfy f(αx+βy) = αf(x)+βf(y) to
       ${Math.max(...Object.values(e5.linearity_violation)).toExponential(0)}. The price is
       <strong>${e5.dim_linear} dimensions instead of ${e5.dim_compact}</strong>. The compact codec is
       what you would ship; this is what you would cite — and the <strong>E5</strong> tab runs it live.`);
  }
  if (a && m) {
    const pick = (d, arm) => d.arms.find(x => x.arm === arm);
    const cA = pick(a, "C_kron_math__block"), bA = pick(a, "A_digit_baseline");
    const cM = pick(m, "C_kron_math__block"), bM = pick(m, "A_digit_baseline");
    setHTML("exGain",
      `Five arms share one backbone — 2 layers, 4 heads, d_model 128, about
       ${Math.round(cA.params / 1000)}k parameters each — so any difference comes from the embedding
       rather than from capacity. On <span class="mono">a + b</span> the digit baseline learns the
       training range perfectly (${pct(bA.acc_in_dist, 0)}) and then scores
       <strong>${pct(bA.acc_ood, 0)}</strong> once the operands get bigger; the same
       backbone with the math block holds <strong>${pct(cA.acc_ood)}</strong>. On
       <span class="mono">a × b</span> it is ${pct(bM.acc_ood, 0)} against
       <strong>${pct(cM.acc_ood)}</strong>. And the error budget lines up: the noise
       study said the decode survives σ ≈ ${e2 ? e2.sigma_at_99pct.ml_rrns : 0.2}, and the
       trained model's actual block error was ${cA.block_rmse_ood.toFixed(3)} — measured
       independently.`);
  }
}

/* --- tabs ------------------------------------------------------------- */
const PANES = ["how", "e1", "e2", "e3", "e4", "e5"];
function initTabs() {
  const tabs = [...document.querySelectorAll(".tab")];
  tabs.forEach(t => t.addEventListener("click", () => {
    tabs.forEach(o => o.setAttribute("aria-selected", String(o === t)));
    PANES.forEach(name => {
      const pane = document.getElementById("pane-" + name);
      if (pane) pane.className = "pane" + (name === t.dataset.pane ? " on" : "");
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
}

/* ---------- the round trip -------------------------------------------- */
const OPS = {
  add: { sym: "+", vec: "⊕", fn: (u, v) => codec.add(u, v), word: "addition" },
  sub: { sym: "−", vec: "⊖", fn: (u, v) => codec.sub(u, v), word: "subtraction" },
  mul: { sym: "×", vec: "⊗", fn: (u, v) => codec.mul(u, v), word: "multiplication" },
  div: { sym: "÷", vec: "⊘", fn: (u, v) => codec.div(u, v), word: "division" },
};

function slotRow(host, vec, scale, cap) {
  host.innerHTML = "";
  for (let i = 0; i < vec.length; i++) {
    const d = document.createElement("div");
    d.className = "slot" + (vec[i] < 0 ? " neg" : "");
    d.style.height = Math.max(1, Math.min(cap, Math.abs(vec[i]) * scale)) + "px";
    const p = codec.primes[Math.floor(i / 5)];
    const which = ["cos α", "sin α", "cos μ", "sin μ", "zero flag"][i % 5];
    hover(d, `<strong>slot ${i} · prime ${p} · ${which}</strong><br>${vec[i].toExponential(6)}`);
    host.appendChild(d);
  }
}

/* The commutative square, drawn rather than described. */
function rtDiagram(a, b, op, y, ok, invertible) {
  const W = 560, H = 152;
  const s = svg(W, H);
  const boxes = [
    { x: 96, y: 30, t: `a = ${a},  b = ${b}`, sub: "two integers" },
    { x: 452, y: 30, t: y === null ? "undefined" : `y = ${y.toLocaleString()}`, sub: `a ${OPS[op].sym} b` },
    { x: 96, y: 116, t: "E(a),  E(b)", sub: "two 35-slot blocks" },
    { x: 452, y: 116, t: `E(a) ${OPS[op].vec} E(b)`, sub: "one 35-slot block" },
  ];
  const arrow = (x1, y1, x2, y2, label, colour) => {
    s.appendChild(el("line", { x1, y1, x2, y2 },
      `stroke:${colour};stroke-width:1.6;marker-end:url(#ah)`));
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    s.appendChild(txt(mx, y1 === y2 ? my - 8 : my, label,
      "fill:var(--text-secondary);font-size:11px"));
  };
  const defs = el("defs");
  const mk = el("marker", { id: "ah", viewBox: "0 0 10 10", refX: 9, refY: 5,
                            markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
  mk.appendChild(el("path", { d: "M 0 0 L 10 5 L 0 10 z" }, "fill:var(--text-muted)"));
  defs.appendChild(mk);
  s.appendChild(defs);

  arrow(190, 30, 372, 30, `arithmetic:  a ${OPS[op].sym} b`, "var(--text-muted)");
  arrow(96, 52, 96, 96, "", "var(--text-muted)");
  s.appendChild(txt(60, 78, "encode", "fill:var(--text-secondary);font-size:11px", "end"));
  arrow(452, 52, 452, 96, "", "var(--text-muted)");
  s.appendChild(txt(516, 78, "encode", "fill:var(--text-secondary);font-size:11px", "start"));
  arrow(190, 116, 372, 116, `on the vectors:  ${OPS[op].vec}`, SV(1));

  boxes.forEach(bx => {
    s.appendChild(txt(bx.x, bx.y + 4, bx.t, "fill:var(--text-primary);font-size:13px;font-weight:600"));
    s.appendChild(txt(bx.x, bx.y + 18, bx.sub, "fill:var(--text-muted);font-size:10.5px"));
  });
  const verdict = !invertible ? "—" : (ok ? "the square commutes" : "MISMATCH");
  s.appendChild(txt(W / 2, H - 4, verdict,
    `fill:${ok && invertible ? "var(--series-3)" : "var(--text-muted)"};font-size:11.5px;font-weight:600`));
  const host = document.getElementById("rtDiagram");
  host.innerHTML = ""; host.appendChild(s);
}

function renderRoundTrip() {
  const a = num("rtA", 0, 84999, 9), b = num("rtB", 0, 84999, 47);
  const rawOp = document.getElementById("rtOp").value;
  const op = OPS[rawOp] ? rawOp : "add";
  const ea = codec.encode(a), eb = codec.encode(b);
  const warn = document.getElementById("rtWarn");

  const invertible = op !== "div" || codec.isInvertible(eb);
  const y = intResult(op, a, b, codec.M);

  if (!invertible || y === null) {
    warn.style.display = "";
    warn.innerHTML = `<strong>${b}</strong> is not invertible in this codec — it shares a factor
      with M = ${codec.M.toLocaleString()}, so a ÷ b has no unique answer here. The block says so
      itself: one of its zero flags is set, which is a purely local read. Pick a b that is not a
      multiple of ${codec.primes.join(", ")}, or use the larger prime set meant for rationals.`;
    ["rtSlotsA", "rtSlotsB", "rtSlotsD"].forEach(i => { document.getElementById(i).innerHTML = ""; });
    setText("rtLabA", ""); setText("rtLabB", "");
    setText("rtDiff", "—");
    const v = document.getElementById("rtVerdict");
    v.textContent = "not invertible"; v.className = "pill bad";
    setText("rtDiffCap", ""); setHTML("rtTable", "");
    rtDiagram(a, b, op, null, false, false);
    return;
  }
  warn.style.display = "none";

  const pathA = codec.encode(y);          // arithmetic first, then embed

  // The refresh step rebuilds the block from its decoded residues, which is
  // why the match below is bit-for-bit rather than merely within rounding.
  // Ticking the box stops before that, showing the bare bilinear product.
  const rawBox = document.getElementById("rtRaw");
  const rawOK = op === "add" || op === "mul";
  rawBox.disabled = !rawOK;
  const rawLab = rawBox.parentElement;
  if (rawLab) {
    rawLab.style.opacity = rawOK ? 1 : 0.45;
    rawLab.title = rawOK ? ""
      : "the raw view is defined for + and ×, which are single bilinear products";
  }
  const raw = rawOK && rawBox.checked;
  const pathB = raw
    ? (op === "add" ? codec.addRaw(ea, eb) : codec.mulRaw(ea, eb))
    : OPS[op].fn(ea, eb);                 // embed first, then operate on the vectors

  let maxDiff = 0;
  const diff = new Float64Array(codec.dim);
  for (let i = 0; i < codec.dim; i++) {
    diff[i] = pathB[i] - pathA[i];
    maxDiff = Math.max(maxDiff, Math.abs(diff[i]));
  }
  const ok = maxDiff < 1e-9;

  setHTML("rtLabA",
    `<span class="step">path 1 &mdash; arithmetic, then embed:</span> ${a} ${OPS[op].sym} ${b} = ${y.toLocaleString()} &rarr; E(${y.toLocaleString()})`);
  setHTML("rtLabB",
    `<span class="step">path 2 &mdash; embed, then operate:</span> E(${a}) ${OPS[op].vec} E(${b})`);
  slotRow(document.getElementById("rtSlotsA"), pathA, 30, 64);
  slotRow(document.getElementById("rtSlotsB"), pathB, 30, 64);

  // the difference, amplified so that "nothing to see" is legible as a result
  const amp = maxDiff > 0 ? 26 / maxDiff : 0;
  const host = document.getElementById("rtSlotsD");
  host.innerHTML = "";
  for (let i = 0; i < codec.dim; i++) {
    const d = document.createElement("div");
    d.className = "slot";
    d.style.background = "var(--text-muted)";
    d.style.height = Math.max(1, Math.abs(diff[i]) * amp) + "px";
    hover(d, `<strong>slot ${i}</strong><br>path 1: ${pathA[i].toExponential(6)}<br>
              path 2: ${pathB[i].toExponential(6)}<br>difference: ${diff[i].toExponential(3)}`);
    host.appendChild(d);
  }
  setHTML("rtDiffCap", maxDiff === 0
    ? "slot-by-slot difference &mdash; every bar is flat because the two vectors are bit-for-bit identical, and the refresh is what makes it exact rather than merely close"
    : `slot-by-slot difference, amplified so it is visible at all (largest is ${maxDiff.toExponential(1)})`);

  // In raw mode the interesting number is per channel group: the channel the
  // operation acts on should already agree, while the other one is stale.
  // A discrete logarithm does not exist where an operand vanishes mod p, so
  // the raw multiplicative identity is claimed only on the channels where it
  // is defined; the zero flag is what covers the rest.
  let live = 0, stale = 0, skipped = 0;
  for (let i = 0; i < codec.k; i++) {
    const b0 = i * 5;
    const A = Math.max(Math.abs(diff[b0]), Math.abs(diff[b0 + 1]));
    const Mm = Math.max(Math.abs(diff[b0 + 2]), Math.abs(diff[b0 + 3]));
    if (op === "mul") {
      if (ea[b0 + 4] > 0.5 || eb[b0 + 4] > 0.5) { skipped++; continue; }
      live = Math.max(live, Mm); stale = Math.max(stale, A);
    } else { live = Math.max(live, A); stale = Math.max(stale, Mm); }
  }
  const v = document.getElementById("rtVerdict");
  if (raw) {
    setText("rtDiff", live.toExponential(2));
    const liveOK = live < 1e-9;
    v.textContent = liveOK ? `${op === "mul" ? "multiplicative" : "additive"} channel matches` : "different";
    v.className = "pill " + (liveOK ? "ok" : "bad");
    setHTML("rtDiffCap",
      `Raw bilinear step, no refresh. The ${op === "mul" ? "multiplicative" : "additive"} channel &mdash;
       the one this operation acts on &mdash; already agrees to ${live.toExponential(1)} from one
       elementwise complex product, with no lookup and no parameters. The other channel is stale
       (off by up to ${stale.toExponential(1)}), and repairing it is the entire job of the refresh.` +
      (skipped ? ` ${skipped} of the ${codec.k} prime channels are excluded here because an operand
       vanishes mod p, where the discrete logarithm does not exist &mdash; that is the case the zero
       flag exists to cover.` : ""));
  } else {
    setText("rtDiff", maxDiff.toExponential(2));
    v.textContent = ok ? "same embedding" : "different";
    v.className = "pill " + (ok ? "ok" : "bad");
  }

  const resB = codec.decodeML(pathB).res, resA = codec.residues(y);
  setHTML("rtTable",
    `<tr><th>prime</th><th>residue via path 1</th><th>residue via path 2</th><th>agree</th></tr>` +
    codec.primes.map((p, i) =>
      `<tr><td>${p}</td><td class="mono">${resA[i]}</td><td class="mono">${resB[i]}</td>
       <td><span class="pill ${resA[i] === resB[i] ? "ok" : "bad"}">${resA[i] === resB[i] ? "yes" : "no"}</span></td></tr>`).join("") +
    `<tr><td colspan="3"><strong>decoded from path 2</strong></td>
     <td class="mono">${codec.crtSubset(resB, ALL_IDX).toLocaleString()}</td></tr>`);

  rtDiagram(a, b, op, y, ok, true);
}

/* ---------- noise, one vector ----------------------------------------- */
let noiseSeedTarget = 1234, noiseDraw = null;
function resample() {
  noiseSeedTarget = Math.floor(Math.random() * PAYLOAD);
  noiseDraw = Array.from({ length: codec.dim }, () => gauss());
  renderNoise();
}
function renderNoise() {
  const sigma = +document.getElementById("sigma").value;
  setText("sigmaVal", sigma.toFixed(3));
  setText("noiseTarget", noiseSeedTarget.toLocaleString());
  const clean = codec.encode(noiseSeedTarget);
  const noisy = Float64Array.from(clean, (v, i) => v + sigma * noiseDraw[i]);

  const host = document.getElementById("slots");
  host.innerHTML = "";
  for (let i = 0; i < codec.dim; i++) {
    const d = document.createElement("div");
    d.className = "slot" + (noisy[i] < 0 ? " neg" : "");
    d.style.height = Math.max(1, Math.abs(noisy[i]) * 30) + "px";
    const p = codec.primes[Math.floor(i / 5)];
    const which = ["cos α", "sin α", "cos μ", "sin μ", "zero flag"][i % 5];
    hover(d, `<strong>prime ${p} · ${which}</strong><br>clean ${clean[i].toFixed(3)}<br>
              noisy ${noisy[i].toFixed(3)}`);
    host.appendChild(d);
  }

  const phaseRes = codec.decodePhase(noisy);
  const phase = codec.crtSubset(phaseRes, ALL_IDX);
  const ml = codec.decodeML(noisy);
  const mlN = codec.crtSubset(ml.res, ALL_IDX);
  const rb = codec.robust(ml.res, 2);
  const rows = [
    ["phase-only CRT", phase, phase === noiseSeedTarget, ""],
    ["nearest codeword (ML)", mlN, mlN === noiseSeedTarget, ""],
    ["ML + error correction", rb.n, rb.n === noiseSeedTarget,
     rb.dropped && rb.dropped.length ? `discarded prime ${rb.dropped.map(i => codec.primes[i]).join(", ")}` : "all primes agreed"],
  ];
  setHTML("decoderTable",
    `<tr><th>decoder</th><th>reads</th><th>correct</th><th>note</th></tr>` +
    rows.map(([n, v, ok, note]) =>
      `<tr><td>${n}</td><td class="mono">${v.toLocaleString()}</td>
       <td><span class="pill ${ok ? "ok" : "bad"}">${ok ? "yes" : "no"}</span></td>
       <td class="note" style="text-align:right">${note}</td></tr>`).join(""));

  const truth = codec.residues(noiseSeedTarget);
  setHTML("e2PerPrime",
    `<tr><th>prime</th><th class="num">true residue</th><th class="num">phase-only</th>
     <th class="num">ML</th><th class="num">ML margin</th><th>lattice spacing</th></tr>` +
    codec.primes.map((p, i) => {
      const okP = phaseRes[i] === truth[i], okM = ml.res[i] === truth[i];
      return `<tr class="${okM ? "" : "miss"}"><td>${p}</td><td class="num">${truth[i]}</td>
        <td class="num" style="color:${okP ? "inherit" : "var(--series-8)"}">${phaseRes[i]}</td>
        <td class="num" style="color:${okM ? "inherit" : "var(--series-8)"}">${ml.res[i]}</td>
        <td class="num">${ml.margin[i].toFixed(3)}</td>
        <td class="num">${(180 / p).toFixed(1)}° half-step</td></tr>`;
    }).join("") +
    `<tr><td colspan="4"><strong>ML margin</strong> is the squared-distance gap to the runner-up
      codeword — small means that prime is about to flip</td><td colspan="2"></td></tr>`);

  drawNoiseChart(sigma);
}

function drawNoiseChart(marker) {
  const d = DATA.e2; if (!d) return;
  const W = 520, H = 250, L = 46, R = 12, T = 14, B = 38;
  const s = svg(W, H);
  const xs = d.rows.map(r => r.sigma);
  const xmax = Math.max(...xs);
  const X = v => L + (v / xmax) * (W - L - R);
  const Y = v => T + (1 - v / 100) * (H - T - B);
  [0, 25, 50, 75, 100].forEach(g => {
    s.appendChild(el("line", { x1: L, y1: Y(g), x2: W - R, y2: Y(g) },
                     "stroke:var(--grid);stroke-width:1"));
    s.appendChild(txt(L - 8, Y(g) + 4, g + "%", INK2, "end"));
  });
  [0, .1, .2, .3, .4, .5].forEach(g => s.appendChild(txt(X(g), H - 16, g.toFixed(1), INK2)));
  s.appendChild(txt(W / 2, H - 2, "Gaussian noise on every slot  (σ)", MUT));

  const series = [["phase_only", "phase-only CRT", SV(5)],
                  ["ml", "nearest codeword (ML)", SV(2)],
                  ["ml_rrns", "ML + error correction", SV(1)]];
  series.forEach(([k, label, col]) => {
    const pts = d.rows.map(r => `${X(r.sigma)},${Y(100 * r[k])}`).join(" ");
    s.appendChild(el("polyline", { points: pts, fill: "none" },
                     `stroke:${col};stroke-width:2;stroke-linejoin:round`));
  });
  const rmse = DATA.e3add && DATA.e3add.arms.find(a => a.arm === "C_kron_math__block");
  if (rmse && rmse.block_rmse_ood) {
    s.appendChild(el("line", { x1: X(rmse.block_rmse_ood), y1: T, x2: X(rmse.block_rmse_ood), y2: Y(0) },
                     "stroke:var(--text-primary);stroke-width:1.4;stroke-dasharray:4 4"));
    s.appendChild(txt(X(rmse.block_rmse_ood) + 6, T + 26,
      `trained model: ${rmse.block_rmse_ood.toFixed(3)}`, INK2, "start"));
  }
  if (marker !== undefined) {
    s.appendChild(el("line", { x1: X(marker), y1: T, x2: X(marker), y2: Y(0) },
                     `stroke:${SV(1)};stroke-width:1.4;opacity:.45`));
  }
  d.rows.forEach(r => {
    const hit = el("rect", { x: X(r.sigma) - 5, y: T, width: 10, height: H - T - B, fill: "transparent" });
    hover(hit, `<strong>σ = ${r.sigma.toFixed(3)}</strong><br>
      phase-only ${pct(r.phase_only, 1)}<br>
      ML ${pct(r.ml, 1)}<br>
      ML + correction ${pct(r.ml_rrns, 1)}`);
    s.appendChild(hit);
  });
  const host = document.getElementById("noiseChart");
  host.innerHTML = ""; host.appendChild(s);
  setHTML("noiseLegend", series.map(([, l, c]) =>
    `<span><span class="swatch" style="background:${c}"></span>${l}</span>`).join(""));
}

function drawTrade() {
  const d = DATA.e2; if (!d) return;
  const t = d.range_vs_robustness;
  const W = 520, H = 250, L = 46, R = 12, T = 16, B = 52;
  const s = svg(W, H);
  const ymax = Math.max(...t.map(x => x.sigma_at_99pct)) * 1.28;
  const Y = v => T + (1 - v / ymax) * (H - T - B);
  const bw = (W - L - R) / t.length;
  [0, .1, .2, .3].filter(g => g <= ymax).forEach(g => {
    s.appendChild(el("line", { x1: L, y1: Y(g), x2: W - R, y2: Y(g) }, "stroke:var(--grid);stroke-width:1"));
    s.appendChild(txt(L - 8, Y(g) + 4, g.toFixed(1), INK2, "end"));
  });
  t.forEach((row, i) => {
    const x = L + i * bw + bw * 0.26, w = bw * 0.48;
    const r = el("rect", { x, y: Y(row.sigma_at_99pct), width: w, height: Y(0) - Y(row.sigma_at_99pct), rx: 4 },
                 `fill:${SV(1)}`);
    hover(r, `<strong>redundancy ${row.redundancy}</strong><br>range &lt; ${row.payload.toLocaleString()}<br>
              corrects ${Math.floor(row.redundancy / 2)} bad residue(s)<br>
              σ@99% = ${row.sigma_at_99pct}`);
    s.appendChild(r);
    s.appendChild(txt(x + w / 2, Y(row.sigma_at_99pct) - 7, row.sigma_at_99pct.toFixed(3), INK2));
    s.appendChild(txt(x + w / 2, H - 32, `redundancy ${row.redundancy}`, INK2));
    s.appendChild(txt(x + w / 2, H - 18, `range < ${row.payload.toLocaleString()}`, MUT));
  });
  const host = document.getElementById("tradeChart");
  host.innerHTML = ""; host.appendChild(s);

  setHTML("e2Trade",
    `<tr><th>redundancy</th><th class="num">primes spent</th><th class="num">exact range</th>
     <th class="num">residues it can repair</th><th class="num">σ at 99% recovery</th></tr>` +
    t.map(row => `<tr><td>${row.redundancy}</td><td class="num">${row.redundancy}</td>
      <td class="num">0 … ${(row.payload - 1).toLocaleString()}</td>
      <td class="num">${Math.floor(row.redundancy / 2)}</td>
      <td class="num"><strong>${row.sigma_at_99pct.toFixed(3)}</strong></td></tr>`).join(""));
}

/* ---------- grouped bars, for E3 and E4 ------------------------------- */
function groupedBars(items, seriesDefs, title) {
  const W = 520, H = 300, L = 44, R = 10, T = 18, B = 74;
  const s = svg(W, H);
  const Y = v => T + (1 - v / 112) * (H - T - B);
  [0, 25, 50, 75, 100].forEach(g => {
    s.appendChild(el("line", { x1: L, y1: Y(g), x2: W - R, y2: Y(g) }, "stroke:var(--grid);stroke-width:1"));
    s.appendChild(txt(L - 8, Y(g) + 4, g + "%", INK2, "end"));
  });
  if (title) s.appendChild(txt(L + (W - L - R) / 2, T - 4, title, INK2));
  const gw = (W - L - R) / items.length;
  items.forEach((it, i) => {
    const base = L + i * gw;
    seriesDefs.forEach((sd, j) => {
      const n = seriesDefs.length, pad = gw * 0.16;
      const w = (gw - 2 * pad) / n - 3;
      const x = base + pad + j * ((gw - 2 * pad) / n);
      const v = 100 * it.values[j];
      const r = el("rect", { x, y: Y(v), width: w, height: Math.max(1, Y(0) - Y(v)), rx: 4 },
                   `fill:${sd.color}`);
      hover(r, `<strong>${it.label.replace(/\n/g, " ")}</strong><br>${sd.label}: ${v.toFixed(2)}%`);
      s.appendChild(r);
      s.appendChild(txt(x + w / 2, Y(v) - 6, v.toFixed(1), INK2));
    });
    it.label.split("\n").forEach((line, li) =>
      s.appendChild(txt(base + gw / 2, H - B + 24 + li * 12, line, li ? MUT : INK2)));
  });
  return s;
}

const PRETTY = {
  A_digit_baseline: "A digit baseline\nlearned embeddings",
  B_kron_only__block: "B Kronecker only\nno math block",
  C_kron_math__block: "C math in and out\nthe proposal",
  D_kron_math__residue: "D math in\n95-logit head",
  F_kron_math__digits: "F math in\ndigit head",
};

function renderE3() {
  const host = document.getElementById("e3Chart");
  host.innerHTML = "";
  const wrap = document.createElement("div"); wrap.className = "grid2";
  let tableHTML = `<tr><th>task</th><th>arm</th><th class="num">params</th><th class="num">in-dist</th>
    <th class="num">OOD</th><th class="num">block RMSE (OOD)</th></tr>`;
  [["e3add", "a + b"], ["e3mul", "a × b"]].forEach(([key, name]) => {
    const d = DATA[key]; if (!d) return;
    const items = d.arms.map(a => ({
      label: PRETTY[a.arm] || a.arm,
      values: [a.acc_in_dist, a.acc_ood],
    }));
    const box = document.createElement("div");
    box.appendChild(groupedBars(items, [
      { label: "in-distribution", color: SV(1) },
      { label: "out-of-distribution", color: SV(2) }],
      `${name} — trained on ${d.train_range[0]}–${d.train_range[1] - 1}, tested on ${d.ood_range[0]}–${d.ood_range[1] - 1}`));
    wrap.appendChild(box);
    d.arms.forEach(a => {
      tableHTML += `<tr><td>${name}</td><td>${a.arm}</td><td class="num">${a.params.toLocaleString()}</td>
        <td class="num">${pct(a.acc_in_dist)}</td><td class="num">${pct(a.acc_ood)}</td>
        <td class="num">${a.block_rmse_ood === undefined ? "—" : a.block_rmse_ood.toFixed(4)}</td></tr>`;
    });
    tableHTML += `<tr><td>${name}</td><td>closed form (no model)</td><td class="num">0</td>
      <td class="num">100.00%</td><td class="num">${pct(d.zero_shot_ood)}</td><td class="num">0</td></tr>`;
  });
  host.appendChild(wrap);
  setHTML("e3Table", tableHTML);
  const a = DATA.e3add, m = DATA.e3mul;
  if (a && m) {
    const c = a.arms.find(x => x.arm === "C_kron_math__block");
    const base = a.arms.find(x => x.arm === "A_digit_baseline");
    setText("e3blurb",
      `Five arms share one backbone — 2 layers, 4 heads, d_model 128, about ${(c.params / 1000).toFixed(0)}k parameters each — ` +
      `so any difference comes from the embedding, not from capacity. The digit baseline learns the training range perfectly ` +
      `(${pct(base.acc_in_dist, 0)} on a + b) and then scores ${pct(base.acc_ood, 0)} the moment the operands get bigger. ` +
      `With the math block on both the input and the output, the same backbone holds ${pct(c.acc_ood)}.`);
  }
}

function renderE4() {
  const d = DATA.e4; if (!d) return;
  const host = document.getElementById("e4Chart"); host.innerHTML = "";
  const wrap = document.createElement("div"); wrap.className = "grid2";
  const arms = d.arms;
  const box1 = document.createElement("div");
  box1.appendChild(groupedBars(
    [{ label: "Kronecker\nword block only", values: [arms[0].acc_in_dist, arms[0].acc_ood] },
     { label: "word block\n+ math block", values: [arms[1].acc_in_dist, arms[1].acc_ood] }],
    [{ label: "in-distribution", color: SV(1) }, { label: "out-of-distribution", color: SV(2) }],
    "whole-sentence accuracy"));
  const box2 = document.createElement("div");
  box2.appendChild(groupedBars(
    ["add", "sub", "mul"].map(op => ({
      label: { add: "addition", sub: "subtraction", mul: "multiplication" }[op],
      values: [arms[0][`acc_ood_${op}`], arms[1][`acc_ood_${op}`]],
    })),
    [{ label: "word block only", color: SV(1) }, { label: "word + math block", color: SV(3) }],
    "out-of-distribution, split by the operation the words asked for"));
  wrap.appendChild(box1); wrap.appendChild(box2);
  host.appendChild(wrap);

  setText("e4blurb",
    `The model reads a sentence such as “take 165 away from 1752 and you have …”. Twelve surface forms across ` +
    `three operations mean it has to understand the words to know what is being asked, while the operands are ` +
    `numbers larger than any it saw in training. With the math dimensions zeroed it scores ` +
    `${pct(arms[0].acc_ood)}; with them populated, ${pct(arms[1].acc_ood)}.`);

  setHTML("e4Table",
    `<tr><th>arm</th><th class="num">params</th><th class="num">in-dist</th><th class="num">OOD</th>
     <th class="num">OOD add</th><th class="num">OOD sub</th><th class="num">OOD mul</th>
     <th class="num">block RMSE</th></tr>` +
    arms.map(a => `<tr><td>${a.arm}</td><td class="num">${a.params.toLocaleString()}</td>
      <td class="num">${pct(a.acc_in_dist)}</td>
      <td class="num">${pct(a.acc_ood)}</td><td class="num">${pct(a.acc_ood_add)}</td>
      <td class="num">${pct(a.acc_ood_sub)}</td><td class="num">${pct(a.acc_ood_mul)}</td>
      <td class="num">${a.rmse_ood.toFixed(4)}</td></tr>`).join(""));
}

/* ---------- wiring ---------------------------------------------------- */
["opA", "opB", "op"].forEach(id =>
  document.getElementById(id).addEventListener("input", renderDials));
document.getElementById("rand").addEventListener("click", () => {
  const op = document.getElementById("op").value;
  const cap = op === "add" ? 40000 : 290;
  document.getElementById("opA").value = Math.floor(Math.random() * cap);
  document.getElementById("opB").value = Math.floor(Math.random() * cap);
  renderDials();
});
["exA", "exB", "exPrime"].forEach(id =>
  document.getElementById(id).addEventListener("input", renderExplainer));
document.getElementById("exRand").addEventListener("click", () => {
  document.getElementById("exA").value = Math.floor(Math.random() * 200) + 2;
  document.getElementById("exB").value = Math.floor(Math.random() * 200) + 2;
  renderExplainer();
});
document.getElementById("exSigma").addEventListener("input", renderExCompare);
document.getElementById("exNoiseRe").addEventListener("click", exResampleNoise);

["rtA", "rtB", "rtOp", "rtRaw"].forEach(id =>
  document.getElementById(id).addEventListener("input", renderRoundTrip));
document.getElementById("rtRand").addEventListener("click", () => {
  const op = document.getElementById("rtOp").value;
  const cap = op === "mul" ? 290 : 40000;
  const a = Math.floor(Math.random() * cap) + 1;
  let b = Math.floor(Math.random() * cap) + 1;
  if (op === "div") { while (!codec.isInvertible(codec.encode(b))) b++; }
  if (op === "sub" && b > a) b = Math.floor(Math.random() * a) + 1;
  document.getElementById("rtA").value = a;
  document.getElementById("rtB").value = b;
  renderRoundTrip();
});
document.getElementById("sigma").addEventListener("input", renderNoise);
document.getElementById("resample").addEventListener("click", resample);
document.getElementById("theme").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.getAttribute("data-theme") === "dark";
  root.setAttribute("data-theme", dark ? "light" : "dark");
  setText("theme", dark ? "Dark" : "Light");
});

noiseDraw = Array.from({ length: codec.dim }, () => gauss());
initTabs();
fillPrimeSelect();
exSeedNoise(12345);
renderExFromData(); renderExplainer();
renderDials(); renderRoundTrip(); renderNoise(); drawTrade(); renderE3(); renderE4();
