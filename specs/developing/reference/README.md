# Reference

Status: authoritative index for current reference material.

Reference docs are looked up, not read end-to-end. This area owns exactly one
artifact — the curated environment-variable catalog. It does not attempt to
inventory every operating system, toolchain, runtime-injected workspace
metadata, bootstrap, workflow, or release variable in the repository. The
related documents below are owned elsewhere and listed here only as pointers.

## Reference Map

| Reference | Owns | Owner |
| --- | --- | --- |
| [env-vars.yaml](env-vars.yaml) | Curated catalog of supported, preferred application/runtime inputs consumed by a Proliferate product process, product build, runtime, or qualification process. | This directory. |
| [guides/local/dev-profiles.md](../../../guides/local/dev-profiles.md) | Configuration locations and precedence for local, self-hosted, hosted, client-build, and workflow surfaces. | The `guides/local/` runbook. |
| [specs/anyharness/workspace-command-environment.md](../../anyharness/workspace-command-environment.md) | AnyHarness workspace-command environment layers, protected metadata, and propagation. | The AnyHarness owner docs. |

## Usage

- Update `env-vars.yaml` when a supported product input is added, renamed,
  removed, or changes its documented default, description, secrecy, or tags.
- Keep deployment/bootstrap-only values and workflow/release controls in their
  owning procedure rather than adding them to the curated catalog.
- Update the `Environment Sources` section of `guides/local/dev-profiles.md`
  when a configuration location or precedence rule changes.
- When changing what is injected into command environments, update
  `specs/anyharness/workspace-command-environment.md` — owned by the AnyHarness
  owner docs, not by this directory — in the same PR.
- Never copy secret values into reference documentation.
