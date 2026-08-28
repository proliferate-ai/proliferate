"""Resolve conflicts in a file by keeping the HEAD (ours) side of every hunk.

Only for hunks verified to be pure `revision -> sequence` rename collisions,
where the other side carries no behavior of its own.
"""

import pathlib
import sys

for arg in sys.argv[1:]:
    path = pathlib.Path(arg)
    out = []
    state = "plain"
    hunks = 0
    for line in path.read_text().splitlines(keepends=True):
        if line.startswith("<<<<<<< "):
            state = "ours"
            hunks += 1
            continue
        if state == "ours" and line.startswith("======="):
            state = "theirs"
            continue
        if state == "theirs" and line.startswith(">>>>>>> "):
            state = "plain"
            continue
        if state != "theirs":
            out.append(line)
    path.write_text("".join(out))
    print(f"{path}: kept ours in {hunks} hunk(s)")
