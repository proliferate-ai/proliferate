#!/usr/bin/env python3
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent
def run(*a): return subprocess.run(["git",*a],cwd=ROOT,capture_output=True,text=True).stdout
old = run("ls-tree","-r","--name-only","HEAD~1","--","specs").splitlines()
new = set(run("ls-tree","-r","--name-only","HEAD","--","specs").splitlines())
status = run("diff","HEAD~1","HEAD","--name-status","-M50").splitlines()
renamed_from, deleted = {}, set()
for line in status:
    parts = line.split("\t")
    if parts[0].startswith("R"): renamed_from[parts[1]] = parts[2]
    elif parts[0] == "D": deleted.add(parts[1])
areas = {p: (ROOT/p).read_text() for p in ["specs/areas/server.md","specs/areas/anyharness.md","specs/areas/frontend.md"]}
unaccounted = []
for f in old:
    if f in new or f in renamed_from: continue
    head = run("show", f"HEAD~1:{f}")
    title = next((l for l in head.splitlines() if l.startswith("# ")), "").strip()
    if title and any(title in t for t in areas.values()):
        continue  # stitched
    unaccounted.append((f, title))
for f, title in unaccounted:
    print("DELETED-NOT-STITCHED", f, "|", title)
print(f"old specs files: {len(old)}; deleted-not-stitched: {len(unaccounted)}")
