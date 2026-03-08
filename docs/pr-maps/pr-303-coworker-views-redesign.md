# PR #303 — Coworker Detail Views Redesign

**Branch:** `feat/coworker-views-redesign`
**Status:** Open | **Base:** #302
**Stats:** +583 / -114 (8 files)

## What it does

Replaces the old Activity/Sessions/Settings tab layout on the coworker detail page with a cleaner three-tab design focused on sessions, chat transcript, and settings.

## Mental model

```
Before:                          After:
  [Activity] [Sessions] [Settings]   [Sessions] [Chat] [Settings]
       ↓                                  ↓
  Run timeline with                 Filterable session     Chronological
  collapsible runs +                list (like main         event stream +
  directive composer                sessions page)          message composer
```

## Key changes

- **Sessions tab** (default): status filter tabs (All/In Progress/Completed/Failed) with counts, search, session table with status dots, titles, branch, updated time
- **Chat tab**: flattens all run events chronologically, shows run dividers, event-type icons, task session links, pending directives as "Queued", message composer with Cmd+Enter
- **Settings tab**: unchanged (name, objective, model, capabilities, status toggle, delete)
- **Header**: removed "Run now" button
- **Types**: extracted `WorkerRunWithEvents`, `PendingDirective`, `ChildSession` from old activity tab into `hooks/automations/types.ts`

## Files

| File | Change |
|------|--------|
| `config/coworkers.ts` | tabs: activity→chat |
| `worker-chat-tab.tsx` | **new** (338 lines) |
| `worker-sessions-tab.tsx` | added filters + search |
| `worker-detail-header.tsx` | removed Run Now |
| `coworkers/[id]/page.tsx` | rewired tabs + chatEvents memo |
| `hooks/automations/types.ts` | **new** — shared types |

## Why it matters

Sessions tab gives quick access to child tasks. Chat tab provides a unified transcript of what the coworker did across all runs without needing to open the manager session.
