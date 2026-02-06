# Trigger Service Specification

> Lightweight webhook receiver that triggers coding agent sessions from external events.

## Overview

Users configure **Automations** that listen for events from their business apps (GitHub, Linear, Slack) and spawn coding agent sessions. This service handles webhook ingestion; polling runs in the Worker.

## Core Objects

### Automation

```typescript
interface Automation {
  id: string;
  organizationId: string;
  name: string;
  instructions: string;   // Prompt for the agent
  enabled: boolean;
  repoId?: string;        // Optional: repo to use for session
}
```

### Trigger

A trigger is either **webhook** or **polling** (not both). Each trigger has a type and provider-specific config.

```typescript
interface Trigger {
  id: string;
  automationId: string;
  connectionId: string;   // OAuth connection for auth
  triggerType: string;    // e.g., "github:issues", "linear:issue"
  config: TriggerConfig;  // Validated by provider
}
```

## Trigger Providers

Each trigger type is a class. Webhook and polling triggers have different interfaces.

### Type Registry

Single source of truth for all trigger types:

```typescript
export const TRIGGERS = {
  issue_opened: "github",
  issue_closed: "github",
  issue_labeled: "github",
  pr_opened: "github",
  pr_merged: "github",
  pr_closed: "github",
  push: "github",
  workflow_failed: "github",
  issue_created: "linear",
  issue_updated: "linear",
  comment_created: "linear",
  message_received: "slack",
} as const;

export type TriggerType = keyof typeof TRIGGERS;
export type Provider = (typeof TRIGGERS)[TriggerType];
```

### WebhookTrigger

```typescript
abstract class WebhookTrigger<T extends TriggerType, TConfig = unknown> {
  abstract readonly id: T;
  abstract readonly provider: (typeof TRIGGERS)[T];
  abstract readonly metadata: TriggerMetadata;
  abstract readonly configSchema: z.ZodSchema<TConfig>;

  abstract webhook(req: Request): Promise<TriggerEvent | null>;
  abstract filter(event: TriggerEvent, config: TConfig): boolean;
  abstract idempotencyKey(event: TriggerEvent): string;
  abstract context(event: TriggerEvent): Record<string, unknown>;
}
```

### PollingTrigger

```typescript
abstract class PollingTrigger<T extends TriggerType, TConfig = unknown> {
  abstract readonly id: T;
  abstract readonly provider: (typeof TRIGGERS)[T];
  abstract readonly metadata: TriggerMetadata;
  abstract readonly configSchema: z.ZodSchema<TConfig>;

  abstract poll(connection: OAuthConnection, config: TConfig, cursor: string | null): Promise<PollResult>;
  abstract filter(event: TriggerEvent, config: TConfig): boolean;
  abstract idempotencyKey(event: TriggerEvent): string;
  abstract context(event: TriggerEvent): Record<string, unknown>;
}
```

### Shared Types

```typescript
interface TriggerEvent {
  type: TriggerType;      // "issue_opened"
  externalId: string;     // Unique ID from provider
  timestamp: Date;
  payload: unknown;
}

interface TriggerMetadata {
  name: string;           // "Issue Opened"
  description: string;
  icon: string;
}

interface PollResult {
  events: TriggerEvent[];
  cursor: string | null;
}
```

### Example: IssueOpenedTrigger

```typescript
class IssueOpenedTrigger extends WebhookTrigger<"issue_opened", IssueOpenedConfig> {
  readonly id = "issue_opened";
  readonly provider = "github";
  readonly metadata = { name: "Issue Opened", description: "When a new issue is created", icon: "github" };
  readonly configSchema = z.object({
    repositories: z.array(z.string()).optional(),
    labels: z.array(z.string()).optional(),
  });

  async webhook(req: Request): Promise<TriggerEvent | null> {
    if (!verifyGitHubSignature(req)) throw new Error("Invalid signature");
    if (req.headers["x-github-event"] !== "issues" || req.body.action !== "opened") return null;
    
    return {
      type: "issue_opened",
      externalId: `${req.body.issue.id}`,
      timestamp: new Date(req.body.issue.created_at),
      payload: req.body,
    };
  }

  filter(event: TriggerEvent, config: IssueOpenedConfig): boolean {
    const p = event.payload as any;
    if (config.repositories?.length && !config.repositories.includes(p.repository.full_name)) return false;
    if (config.labels?.length) {
      const issueLabels = p.issue.labels?.map((l: any) => l.name) ?? [];
      if (!config.labels.some(l => issueLabels.includes(l))) return false;
    }
    return true;
  }

  idempotencyKey(event: TriggerEvent): string {
    return `issue_opened:${event.externalId}`;
  }

  context(event: TriggerEvent): Record<string, unknown> {
    const p = event.payload as any;
    return {
      repository: p.repository.full_name,
      issue: { number: p.issue.number, title: p.issue.title, body: p.issue.body, url: p.issue.html_url },
    };
  }
}
```

## Architecture

```
External Service ──webhook──▶ Trigger Service ──create session──▶ Gateway
                                    │
                              (matches triggers,
                               calls Gateway API)
```

**Polling** runs in the Worker via BullMQ repeatable jobs.

## Service Endpoints

```
GET  /health                    # Health check
GET  /providers                 # List trigger types (for UI)
POST /webhooks/:provider        # Receive webhooks
```

### Webhook Flow

1. Receive webhook at `/webhooks/github`
2. Find webhook triggers that handle this event type
3. For each trigger where `filter()` returns true:
   - Generate idempotency key
   - Call Gateway to create session
4. Return 200 OK

## Database Schema

```sql
CREATE TABLE automations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  instructions TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  repo_id TEXT REFERENCES repos(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE triggers (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES integrations(id),
  trigger_type TEXT NOT NULL,  -- e.g., "issue_opened", "pr_merged"
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_triggers_trigger_type ON triggers(trigger_type);

CREATE TABLE automation_connections (
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  PRIMARY KEY (automation_id, connection_id)
);

-- Session additions
ALTER TABLE sessions ADD COLUMN automation_id TEXT REFERENCES automations(id);
ALTER TABLE sessions ADD COLUMN trigger_event_id TEXT;

CREATE UNIQUE INDEX idx_sessions_automation_trigger_event 
ON sessions(automation_id, trigger_event_id) 
WHERE automation_id IS NOT NULL;
```

## Session Creation

Trigger service calls Gateway to create sessions:

```typescript
await gateway.createAutomationSession({
  automationId: trigger.automation_id,
  triggerId: trigger.id,
  triggerEventId: idempotencyKey,
  eventContext: context,
});
```

Gateway:
- Creates session with `automation_id` and `trigger_event_id`
- Postgres unique constraint prevents duplicates
- Injects connection tokens as env vars
- Session runs until agent calls `stop` tool

## Connections in Sandbox

When creating an automation session, Gateway injects tokens for all connections in `automation_connections`:

```bash
CONNECTION_GITHUB_abc123_TOKEN=gho_xxxx
CONNECTION_LINEAR_def456_TOKEN=lin_xxxx
```

A `refresh_connection` tool is available if tokens expire.

## Polling (in Worker)

Polling triggers run as BullMQ repeatable jobs in the Worker:

1. Load polling trigger config
2. Call `poll(connection, config, cursor)`
3. For each event where `filter()` returns true:
   - Generate idempotency key
   - Create session via Gateway
4. Update cursor in Redis

## Open Questions

1. Should we auto-register webhooks with providers, or require manual setup?
2. Should we store event history for debugging/replay?
3. How do we handle config schema migrations?
