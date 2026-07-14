# Reference

Status: authoritative index for current reference material.

Reference docs are looked up, not read end-to-end. This area separates the
curated catalog of supported product inputs from the procedures and source
locations that supply them. It does not attempt to inventory every operating
system, toolchain, runtime-injected workspace metadata, bootstrap, workflow,
or release variable in the repository.

## Reference Map

| Reference | Owns |
| --- | --- |
| [env-vars.yaml](env-vars.yaml) | Curated catalog of supported, preferred application/runtime inputs consumed by a Proliferate product process, product build, runtime, or qualification process. |
| [environment-sources.md](environment-sources.md) | Configuration locations and precedence for local, self-hosted, hosted, client-build, and workflow surfaces. |
| [workspace-command-environment.md](workspace-command-environment.md) | AnyHarness workspace-command environment layers, protected metadata, and propagation. |

## Usage

- Update `env-vars.yaml` when a supported product input is added, renamed,
  removed, or changes its documented default, description, secrecy, or tags.
- Keep deployment/bootstrap-only values and workflow/release controls in their
  owning procedure rather than adding them to the curated catalog.
- Update `environment-sources.md` when a configuration location or precedence
  rule changes.
- When changing what is injected into command environments, update
  `workspace-command-environment.md` in the same PR.
- Never copy secret values into reference documentation.
