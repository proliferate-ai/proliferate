# Agent Session Controls

Session controls are opaque, target-observed launch inputs. There is no
repository-owned mode matrix and no harness-specific unattended-mode table.

## Source of truth

For a selected target and harness, the runtime owns the complete executable
surface returned by `GET /v1/agents/{kind}/launch-options`:

- exact model IDs
- control keys, value IDs, labels, descriptions, and requiredness
- exact defaults when the target reports them
- observation state, basis revision, revision, timestamps, and probe failure

The distribution catalog may contain presentation labels and install pins. It
must not contain executable model, mode, control, fallback, or filtering data.

## Before launch

Product surfaces preserve exact selected `modelId` and `controlValues`. Saved
and background consumers persist the complete intent rather than projecting a
singleton `modeId`. At create time AnyHarness reloads one current observation,
validates the model and all controls exactly, rejects missing or unknown values,
and durably commits the resolved launch intent before spawning the actor.

Omission means omission. Neither Product nor AnyHarness may infer a permissive
mode, use the first returned option, alias a value, intersect stale controls, or
fall back to catalog data.

## After launch

The actor applies the committed control map before reporting ready and reads it
back through ACP. The live session-config snapshot is authoritative for active
session UI. Full snapshots replace prior snapshots so removed controls cannot
survive locally as stale state.

`collaboration_mode` is just another target-observed control. Its meaning and
allowed values come from the selected target; repository code does not map it
to a separate mode vocabulary.
