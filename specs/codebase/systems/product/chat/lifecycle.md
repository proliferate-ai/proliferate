# Chat Lifecycle

Status: authoritative for user-visible chat creation and identity transitions.

This document answers whether a model selection creates, preserves, or
replaces the visible chat identity. It does not own tab ordering, runtime
process mechanics, model availability, or source organization.

## Visible Transitions

```text
no active chat
  -> create from the resolved selection

update_current_chat
  -> preserve the durable chat/session identity

open_new_chat + empty visible chat
  -> replace the unused backend session
  -> retain one visible tab

open_new_chat + existing messages
  -> preserve the old transcript
  -> create and activate a new session tab
```

A same-harness selection is `update_current_chat`, so it preserves the durable
session even if AnyHarness must replace the live agent process. A
different-harness selection is `open_new_chat`. The current shell determines
whether that action replaces an unused backend session or adds another visible
session tab; it does not guarantee the new tab's immediate-right placement.

## Related Owners

- [Model Catalog](../../../platforms/product/model-catalog.md) owns model
  identity, availability, and action classification.
- [Composer](composer.md) owns input, controls, picker presentation, panels,
  and badges.
- [Workspaces](../workspaces/README.md) owns tab ordering, restoration, and
  projected-shell mechanics.
- [AnyHarness sessions](../../../structures/anyharness/src/sessions.md) owns
  actor/config application, process retirement, and relaunch.
- [Frontend structure](../../../structures/frontend/README.md) owns source
  placement.
