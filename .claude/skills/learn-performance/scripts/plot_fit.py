"""Plot the measured tempo, its smoothed shape, and what the fitted performance file plays.
Needs the --curves file from fit-performance. Usage: .venv/bin/python plot_fit.py analysis/X  → analysis/X/fit.png"""
import json, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

work = sys.argv[1]
d = np.genfromtxt(f"{work}/curves.csv", delimiter=",", names=True)
s = json.load(open(f"{work}/score-notes.json"))
fig, ax = plt.subplots(figsize=(16, 4.5))
ax.plot(d["q"], d["measured"], lw=0.5, color="0.75", label="measured (per beat)")
ax.plot(d["q"], d["smoothed"], lw=1.6, color="C3", label="smoothed shape")
ax.plot(d["q"], d["model"], lw=1.4, color="C0", label="performance file")
starts = [m["q0"] for m in s["measures"]]
labels = [m["label"] for m in s["measures"]]
step = max(1, len(starts) // 28)
ax.set_xticks(starts[::step])
ax.set_xticklabels(labels[::step], fontsize=7)
ax.set_ylim(20, 140)
ax.set_xlim(0, s["endQ"])
ax.set_xlabel("bar")
ax.set_ylabel("BPM")
ax.legend(loc="upper right", fontsize=8)
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(f"{work}/fit.png", dpi=90)
print(f"wrote {work}/fit.png")
