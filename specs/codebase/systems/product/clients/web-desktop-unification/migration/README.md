# Web/Desktop Unification Migration Evidence

- [ProductClient extraction mechanics](d1g.md) records the landed build,
  packaging, ledger, codemod, and browser-host proof consumed by the
  mechanical extraction.
<<<<<<< HEAD
- [Desktop product move](d1h.md) records the mechanical move of the working
  Desktop product into `@proliferate/product-client`, leaving Desktop a thin
  native host.
- [Legacy Web replacement](d1i.md) records deleting the duplicate Web product
  and mounting the shared ProductClient from a thin browser host with
  `desktop: null`.
- [`web-bundle-baseline-c6e094b41.json`](web-bundle-baseline-c6e094b41.json) is
  the binding legacy-Web bundle baseline for the phase-6 cutover no-regression
  gate, captured on the untouched base `c6e094b41`.
=======
- [Move the Desktop Product into ProductClient](d1h.md) records the completed
  mechanical move and seam architecture, plus the post-merge reconciliation
  against `origin/main` — PR #1215, merge `c6e094b41`.
>>>>>>> origin/main

Completed incremental delivery specs live in Git history. Current architecture
and migration state live in the [parent system contract](../README.md).
