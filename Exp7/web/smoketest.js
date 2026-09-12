/* Minimal DOM shim: executes the real page scripts and reports any runtime
   error, plus how much markup each section actually produced. */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const made = { svg: 0, rect: 0, text: 0, polyline: 0, circle: 0, line: 0 };
function node(tag) {
  if (made[tag] !== undefined) made[tag]++;
  const n = {
    tagName: tag, children: [], style: {}, attrs: {}, _html: "",
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    addEventListener() {},
    set innerHTML(v) { this._html = v; this.children = []; },
    get innerHTML() { return this._html; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; },
    set className(v) { this._cls = v; },
  };
  return n;
}
const store = {};
const document = {
  documentElement: { getAttribute: () => "light", setAttribute: () => {} },
  getElementById(id) { return store[id] || (store[id] = node("div")); },
  querySelectorAll() { return []; },
  createElement: node,
  createElementNS: (_ns, tag) => node(tag),
};
const inputs = {
  opA: "9", opB: "47", op: "add", sigma: "0.12",
  rtA: "9", rtB: "47", rtOp: "add",
  exA: "9", exB: "47", exPrime: "1", exSigma: "0.05",
  e1Check: "add_full", e1Trials: "1000",
  e2N: "200", e2Red: "2",
  dcB: "5", raP1: "153", raQ1: "142", raP2: "271", raQ2: "154",
  aiArm: "C_kron_math__block", aiA: "473", aiB: "89", aiOp: "+",
  dgTask: "add",
  sbOp: "add", sbTpl: "0", sbSplit: "ood", kwToken: "difference",
  lcA: "9", lcB: "47", lcOp: "add",
  linAlpha: "0.37", linBeta: "-1.9", linN: "8",
  lmPrime: "1", lmPart: "re",
};
Object.keys(inputs).forEach(k => { store[k] = node("input"); store[k].value = inputs[k]; });
["rtRaw", "sbZero"].forEach(k => {
  store[k] = node("input"); store[k].checked = false; store[k].parentElement = node("label");
});

const ctx = { document, window: { innerWidth: 1200, scrollTo() {} }, innerWidth: 1200, console,
              Math, BigInt, Float64Array, Int32Array, Array, Object, JSON, Number, String,
              setTimeout: (fn) => fn() };
ctx.globalThis = ctx;

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log(`found ${scripts.length} inline scripts`);
try {
  vm.createContext(ctx);
  scripts.forEach((s, i) => vm.runInContext(s, ctx, { filename: `inline-${i}.js` }));
} catch (e) {
  console.error("RUNTIME ERROR:", e.message, "\n", e.stack.split("\n").slice(0, 5).join("\n"));
  process.exit(1);
}
console.log("all scripts executed with no error");
/* top-level const/class are lexical bindings, not properties of the global */
const evalIn = expr => vm.runInContext(expr, ctx);
console.log("svg elements built:", JSON.stringify(made));

let fail = 0;
function need(label, value, minLen = 1) {
  const s = String(value === undefined ? "" : value);
  const ok = s.length >= minLen && !s.includes("undefined") && !s.includes("NaN");
  if (!ok) fail++;
  console.log(`  ${label.padEnd(16)} ${ok ? "OK  " : "BAD "} ${s.slice(0, 96).replace(/\s+/g, " ")}`);
}
function rows(id) { return (store[id]._html.match(/<tr/g) || []).length; }
function needRows(id, want) {
  const n = rows(id);
  const ok = n >= want;
  if (!ok) fail++;
  console.log(`  ${id.padEnd(16)} ${n} rows ${ok ? "OK" : "TOO FEW (want " + want + ")"}`);
}

console.log("\nhow-it-works tab:");
[["decoded", store.decoded._text], ["verdict", store.verdict._text],
 ["truth", store.truth._text], ["exZero", store.exZero._html],
 ["exDialCap", store.exDialCap._html, 60], ["exGlue", store.exGlue._html, 200],
 ["exGain", store.exGain._html, 200], ["exCompareNote", store.exCompareNote._html, 100]]
  .forEach(([k, v, m]) => need(k, v, m || 1));
[["exAddTable", 9], ["exMulTable", 9], ["exBlock", 9], ["exCompare", 4], ["exDecode", 4]]
  .forEach(([id, w]) => needRows(id, w));
console.log("  dial rows:", store.dials.children.length,
            " focused-prime rows:", store.exDials.children.length);

console.log("\nE1 tab:");
[["e1Total", store.e1Total._text], ["e1blurb", store.e1blurb._text, 80]]
  .forEach(([k, v, m]) => need(k, v, m || 1));
[["e1Table", 16], ["e1RT", 4], ["e1Log", 1], ["dcOut", 2], ["raOut", 3]]
  .forEach(([id, w]) => needRows(id, w));
needRows("e1Stats", 0);
need("e1Stats", store.e1Stats._html, 100);

console.log("\n  running E1 checks in-process:");
for (const id of ["add_full", "add_small", "mul_full", "mul_zero", "sub", "powk",
                  "div", "expr", "rt", "raw", "rational"]) {
  let r;
  try { r = ctx.e1RunCheck(id, 200); }
  catch (e) { console.log(`    ${id.padEnd(10)} THREW ${e.message}`); fail++; continue; }
  const ok = r && r.ok === r.n && r.n > 0;
  if (!ok) fail++;
  console.log(`    ${id.padEnd(10)} ${String(r.ok).padStart(6)}/${String(r.n).padEnd(6)} ` +
              `${r.ms}ms  ${ok ? "OK" : "FAIL " + (r.miss || []).join("; ")}`);
}

console.log("\nE2 tab:");
needRows("decoderTable", 4);
needRows("e2PerPrime", 8);
needRows("e2Trade", 4);
need("e2Stats", store.e2Stats._html, 100);
{
  const cd = evalIn("codec");
  const row = ctx.e2SweepStep(0.0, [1234, 4321], [cd.encode(1234), cd.encode(4321)], 2);
  const ok = row.phase_only === 1 && row.ml === 1 && row.ml_rrns === 1;
  if (!ok) fail++;
  console.log(`  sweep at σ=0    ${JSON.stringify(row)} ${ok ? "OK" : "FAIL — should be perfect"}`);
}

console.log("\nE3 tab:");
[["e3blurb", store.e3blurb._text, 80], ["aiDesc", store.aiDesc._html, 60],
 ["aiInput", store.aiInput._html, 100], ["aiTarget", store.aiTarget._html, 40],
 ["aiLoss", store.aiLoss._html, 40], ["aiKron", store.aiKron._html, 80],
 ["dgNote", store.dgNote._html, 100], ["ebNote", store.ebNote._html, 150],
 ["e3Stats", store.e3Stats._html, 100]].forEach(([k, v, m]) => need(k, v, m));
[["e3Table", 6], ["dgTable", 6], ["hcTable", 4]].forEach(([id, w]) => needRows(id, w));

console.log("\nE4 tab:");
[["sbSentence", store.sbSentence._html, 20], ["sbMeta", store.sbMeta._html, 60],
 ["sbBand", store.sbBand._html, 200], ["sbClosed", store.sbClosed._html, 100],
 ["kwMeta", store.kwMeta._html, 40], ["kwBand", store.kwBand._html, 80],
 ["e4Words", store.e4Words._html, 100], ["e4blurb", store.e4blurb._text, 80],
 ["e4Stats", store.e4Stats._html, 100]].forEach(([k, v, m]) => need(k, v, m));
needRows("e4Table", 3);

console.log("\nE5 tab:");
[["lcDecoded", store.lcDecoded._text], ["lcVerdict", store.lcVerdict._text],
 ["lcTruth", store.lcTruth._text, 20], ["lcSlotCap", store.lcSlotCap._html, 40],
 ["linOut", store.linOut._html, 150], ["linCompact", store.linCompact._html, 150],
 ["lmNote", store.lmNote._html, 120], ["lmBoxes", store.lmBoxes._html, 300],
 ["e5blurb", store.e5blurb._text, 60], ["e5Stats", store.e5Stats._html, 100]]
  .forEach(([k, v, m]) => need(k, v, m || 1));
[["lcTable", 8], ["e5Table", 9]].forEach(([id, w]) => needRows(id, w));
{
  const ok = store.lcVerdict._text === "exact";
  if (!ok) fail++;
  console.log(`  linear codec 9 + 47 -> ${store.lcDecoded._text}  ${ok ? "OK" : "FAIL"}`);
  const lin = store.linOut._html;
  const linOK = (lin.match(/>linear</g) || []).length === 2;
  if (!linOK) fail++;
  console.log(`  both refresh maps reported linear: ${linOK ? "OK" : "FAIL"}`);
}
/* the 373-dim codec, checked directly against the compact one */
{
  const L = ctx.lc();
  let bad = 0;
  for (const [a, b, op] of [[9, 47, "add"], [0, 5, "mul"], [123, 456, "mul"],
                            [40000, 40000, "add"], [7, 0, "mul"], [1, 1, "mul"]]) {
    const w = op === "add" ? L.add(L.encode(a), L.encode(b)) : L.mul(L.encode(a), L.encode(b));
    const want = op === "add" ? (a + b) % L.M : ctx.intResult("mul", a, b, L.M);
    const ref = L.encode(want);
    let dev = 0;
    for (let i = 0; i < L.dim; i++) dev = Math.max(dev, Math.abs(w[i] - ref[i]));
    const got = L.decode(w);
    const ok = got === want && dev < 1e-9;
    if (!ok) { bad++; fail++; }
    console.log(`  ${String(a).padStart(5)} ${op} ${String(b).padEnd(6)} -> ${String(got).padEnd(9)} ` +
                `dev ${dev.toExponential(1)}  ${ok ? "OK" : "FAIL (want " + want + ")"}`);
  }
}

/* Drive the round-trip panel through every operation and both refresh modes. */
console.log("\nround-trip panel:");
for (const [a, b, op, raw, expect] of [
  [9, 47, "add", false, "same embedding"], [9, 47, "add", true, "additive channel matches"],
  [100, 42, "sub", false, "same embedding"], [123, 456, "mul", false, "same embedding"],
  [123, 456, "mul", true, "multiplicative channel matches"],
  [123, 457, "mul", true, "multiplicative channel matches"],
  [84, 4, "div", false, "same embedding"], [84, 5, "div", false, "not invertible"],
]) {
  store.rtA.value = String(a); store.rtB.value = String(b);
  store.rtOp.value = op; store.rtRaw.checked = raw;
  try { ctx.renderRoundTrip(); } catch (e) { console.log(`  ${op} FAILED: ${e.message}`); fail++; continue; }
  const got = store.rtVerdict._text, diff = store.rtDiff._text;
  const ok = got === expect;
  if (!ok) fail++;
  console.log(`  ${a} ${op} ${b}${raw ? " (raw)" : ""}`.padEnd(26) +
              `diff ${String(diff).padEnd(10)} -> ${got}  ${ok ? "OK" : "EXPECTED " + expect}`);
}

/* Drive the E3/E4 widgets across their options. */
console.log("\nwidget sweeps:");
for (const arm of ["A_digit_baseline", "B_kron_only__block", "C_kron_math__block",
                   "D_kron_math__residue", "F_kron_math__digits"]) {
  store.aiArm.value = arm;
  try { ctx.renderArmInspector(); } catch (e) { console.log(`  ${arm} THREW ${e.message}`); fail++; continue; }
  const ok = store.aiInput._html.length > 80 && store.aiTarget._html.length > 30;
  if (!ok) fail++;
  console.log(`  arm ${arm.padEnd(22)} ${ok ? "OK" : "EMPTY"}`);
}
for (const task of ["add", "mul"]) {
  store.dgTask.value = task;
  try { ctx.renderDigitCollapse(); } catch (e) { console.log(`  dg ${task} THREW ${e.message}`); fail++; continue; }
  const blind = store.dgTable._html.includes("<strong>");
  if (!blind) fail++;
  console.log(`  digit-collapse ${task.padEnd(4)} ${blind ? "OK (found unsupervised digit values)" : "FAIL"}`);
}
for (const op of ["add", "sub", "mul"]) {
  for (const split of ["train", "ood"]) {
    store.sbOp.value = op; store.sbSplit.value = split;
    try { ctx.initPanelsSample ? ctx.initPanelsSample() : ctx.sbSample(); }
    catch (e) { console.log(`  sb ${op}/${split} THREW ${e.message}`); fail++; continue; }
    const ok = store.sbBand._html.length > 200 && store.sbClosed._html.includes("keypoint");
    if (!ok) fail++;
    console.log(`  sentence ${op}/${split.padEnd(6)} ${ok ? "OK" : "EMPTY"}`);
  }
}
for (let i = 0; i < 7; i++) {
  store.lmPrime.value = String(i);
  try { ctx.renderMatrices(); } catch (e) { console.log(`  matrix ${i} THREW ${e.message}`); fail++; continue; }
  if (store.lmBoxes._html.length < 300) fail++;
}
console.log("  matrix panels for all 7 primes: OK");

if (made.svg === 0 || fail) {
  console.error(`\nFAILURES: ${fail}   svgs: ${made.svg}`);
  process.exit(1);
}
console.log("\nPASS");
