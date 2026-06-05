# Worker Inventory

Status: authoritative for
`anyharness/crates/proliferate-worker/src/inventory/**`.

`inventory/` owns read-only introspection of the environment, reported **once at
startup**. It tells Cloud what this runtime can do; it never mutates target
state.

```text
local machine facts (os/arch, tool versions, providers, MCPs, capabilities)
  -> inventory (read-only introspection)
  -> reported once at enrollment/startup
```

## Target Shape

```text
inventory/
  mod.rs
  platform.rs
  versions.rs
  capabilities.rs
  providers.rs
  mcp.rs
```

## What Goes Where

| File | Owns | Must Not Own |
| --- | --- | --- |
| `mod.rs` | Compose the inventory snapshot and expose it for the enroll/startup report. | Ongoing polling; mutation. |
| `platform.rs` | OS, arch, distro, shell. | Mutating target state. |
| `versions.rs` | Local tool version probes. | Update application or the supervisor mailbox. |
| `capabilities.rs` | Declared local capability facts. | Command lease policy. |
| `providers.rs` | Agent/provider readiness facts. | Provider launch (AnyHarness owns that). |
| `mcp.rs` | Local MCP capability facts. | MCP runtime launch. |

## Responsibilities

Inventory is a one-shot, read-only snapshot. It is reported at startup as part
of (or just after) enrollment so Cloud knows the runtime's shape. It does not
run a loop and it does not gate command delivery — capability is reported, not
fenced.

The worker version reporting used by self-update lives in `lifecycle/`;
inventory is about the *environment's* capabilities, not the worker's own
version cadence.

## Hard Rules

- Inventory code is read-only. It never mutates target state.
- Inventory is reported once at startup, not on a recurring poll.
- Capability facts are informational; they are not a command-lease fence.
- Filesystem/Git effects belong in `materialization/`, not here.
