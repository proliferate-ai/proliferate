# Rust observability v1 golden contract

The protocol source lives in the versioned Rust, TypeScript, and Python
representations. These fixtures pin their shared serialized meaning; they are
not a second schema authority.

- `valid/records.json` covers detailed records, lifecycle starts, every terminal
  outcome, collector-finalized abandonment, and safe model/plugin metadata.
- `valid/api.json` covers connection, ingest, query, tail, export, and health
  shapes.
- `valid/lifecycle-sequences.json` pins start, retry, terminal, conflict,
  producer-death abandonment, and orphan-terminal handling.
- `invalid/records.json` pins record rejection reasons.
- `invalid/api.json` pins authenticated-loopback and bounded API failures.
- `limits.json` pins every v1 cardinality, byte, page, frame, export, RSS, and
  arena boundary.
- `rss-profile.json` is the release-build measurement profile PR 2 must execute.

The targeted Rust, ProductClient, and server contract tests all consume this
same tree.
