"""Inline the codec, the results and the app into one self-contained index.html."""
import json, pathlib, re

HERE = pathlib.Path(__file__).resolve().parent
RESULTS = HERE.parent / "results"

def load(name):
    p = RESULTS / name
    return json.loads(p.read_text()) if p.exists() else None

data = {k: load(f) for k, f in [
    ("e1", "e1_exactness.json"), ("e2", "e2_noise.json"),
    ("e3add", "e3_add.json"), ("e3mul", "e3_mul.json"), ("e4", "e4_mixed_lm.json"),
    ("e5", "e5_linear_refresh.json")]}
missing = [k for k, v in data.items() if v is None]
if missing:
    print(f"warning: no results yet for {missing} -- run the experiments first")

def script(name):
    return re.sub(r"^export ", "", (HERE / name).read_text(), flags=re.M)

html = (HERE / "template.html").read_text()
for token, name in [("CODEC", "codec.js"), ("LINEAR", "linear.js"), ("KRON", "kron.js"),
                    ("APP", "app.js"), ("PANELS", "panels.js")]:
    html = html.replace(f"/*__{token}__*/", script(name))
html = html.replace("/*__DATA__*/", "const DATA = " + json.dumps(data) + ";")
(HERE / "index.html").write_text(html)
kb = len(html.encode()) / 1024
print(f"wrote web/index.html ({kb:.0f} KB, self-contained -- just open it)")
