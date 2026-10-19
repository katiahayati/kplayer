"""Each bar's start time in the recording and its tempo, from an alignment.
Usage: .venv/bin/python bar_tempos.py analysis/X [FIRST_BAR LAST_BAR]"""
import json, sys
import numpy as np

work = sys.argv[1]
a = np.array(json.load(open(f"{work}/alignment.json"))["onsets"])
s = json.load(open(f"{work}/score-notes.json"))
T = lambda q: float(np.interp(q, a[:, 0], a[:, 1]))
labels = [m["label"] for m in s["measures"]]
lo = labels.index(sys.argv[2]) if len(sys.argv) > 2 else 0
hi = labels.index(sys.argv[3]) + 1 if len(sys.argv) > 3 else len(labels)
mmss = lambda t: f"{int(t // 60)}:{t % 60:04.1f}"
print("bar   starts at   tempo (quarter notes per minute)")
for m in s["measures"][lo:hi]:
    dt = T(m["q1"]) - T(m["q0"])
    print(f"{m['label']:>4}   {mmss(T(m['q0'])):>7}     {60 * (m['q1'] - m['q0']) / dt:6.1f}")
