# Ownership Atlas generator

Regenerates the Ownership Atlas: a single HTML page showing which spec system owns each region of the Proliferate codebase, sized by lines of code and colored by role.

Run `python3 scripts/ownership-atlas/generate.py` to write `ownership-atlas.html` next to this script (pass a path argument to write elsewhere instead).

The ownership table — path, spec, role, status, note — is the `OWNERSHIP` list at the top of `generate.py`; edit it there when a ruling lands or a wave executes, then re-run the command above.

To refresh the shared page, paste the regenerated `ownership-atlas.html` to Claude and ask it to republish the artifact.
