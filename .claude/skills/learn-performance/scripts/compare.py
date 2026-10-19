"""Average tempo by passage for several performances of the same score, side by side.
Usage: .venv/bin/python compare.py analysis/A analysis/B ... -- 1-11 12-20 21-40 ...
(bar ranges by printed bar number; without them, every 8 bars)."""
import bisect, json, sys

args = sys.argv[1:]
works = args[: args.index("--")] if "--" in args else args
ranges = [r.split("-") for r in args[args.index("--") + 1 :]] if "--" in args else []


def timeline(work):
    on = json.load(open(f"{work}/alignment.json"))["onsets"]
    qs, ts = [o[0] for o in on], [o[1] for o in on]

    def at(q):
        i = max(1, min(bisect.bisect_right(qs, q), len(qs) - 1))
        return ts[i - 1] + (q - qs[i - 1]) * (ts[i] - ts[i - 1]) / (qs[i] - qs[i - 1])

    return at, qs[-2]  # the last onset: after it, the recording only has the release


measures = json.load(open(f"{works[0]}/score-notes.json"))["measures"]
first = {m["label"]: m for m in reversed(measures)}
last = {m["label"]: m for m in measures}
if not ranges:
    labels = [m["label"] for m in measures]
    ranges = [[labels[i], labels[min(i + 7, len(labels) - 1)]] for i in range(0, len(labels), 8)]
lines = [(w.rstrip("/").split("/")[-1], *timeline(w)) for w in works]
print(f"{'bars':>9}  " + "".join(f"{name:>14}" for name, _, _ in lines) + "   (average quarter notes per minute)")
for a, b in ranges:
    q0 = first[a]["q0"]
    row = []
    for _, at, end in lines:
        q1 = min(last[b]["q1"], end)
        row.append(60 * (q1 - q0) / (at(q1) - at(q0)))
    print(f"{a + '–' + b:>9}  " + "".join(f"{v:14.0f}" for v in row))
for name, at, end in lines:
    print(f"{name}: {at(end) - at(0):.0f} s from bar 1 to the last note")
