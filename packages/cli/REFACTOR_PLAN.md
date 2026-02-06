# CLI Refactor Plan ✓ DONE

## Philosophy

The CLI is **incredibly simple**. It does one thing: open OpenCode connected to your sandbox.

## State

Two pieces of state, both in `~/.proliferate/`:
1. **Auth** — token, user, org
2. **Config** — preferences (sync mode, etc.)

Before any command runs, both must be settled.

## Commands

```bash
proliferate          # Main command — sync + opencode
proliferate reset    # Clear state
```

That's it.

## Flow

```
proliferate
    │
    ├─► Auth settled?
    │   └─ No → Device flow login
    │
    ├─► Config settled?
    │   └─ No → Quick prompts (sync mode, etc.)
    │
    ├─► Get box info (creates sandbox if needed)
    │
    ├─► Sync workspace
    │
    └─► Launch opencode --attach
```

## Current Problems

1. **Too many commands** — chat, login, logout, config, update, uninstall, help
2. **sync.ts is 885 lines** — doing too much
3. **api.ts mixes web app + gateway** — should use gateway-sdk
4. **chat.ts orchestration is buried** — should be top-level and obvious

## Proposed Structure

```
cli/src/
├── index.ts              # Entry: parse args, run main or reset
│
├── main.ts               # The ONE flow: auth → config → box → sync → opencode
│
├── state/
│   ├── auth.ts           # Load/save auth, device flow if missing
│   └── config.ts         # Load/save config, prompt if missing
│
├── sync/
│   ├── index.ts          # Sync orchestration
│   ├── rsync.ts          # Rsync execution
│   └── sources.ts        # What to sync (CONFIG_SOURCES)
│
├── agents/
│   └── opencode.ts       # Find binary, launch with attach URL
│
└── lib/
    ├── device-flow.ts    # Device code auth (only thing that needs web app)
    ├── ssh.ts            # SSH key gen
    └── constants.ts
```

Note: **No `api.ts`** — session creation and sandbox info now go through gateway-sdk.

## The Main Flow (main.ts)

```typescript
export async function main(): Promise<void> {
  // 1. Ensure auth (device flow if needed, health check if exists)
  const auth = await ensureAuth();
  
  // 2. Ensure config (prompt if needed)
  const config = await ensureConfig();
  
  // 3. Create session + get sandbox info
  // ... (see Gateway Integration below)
  
  // 4. Sync workspace
  await sync(cwd, { host, port });
  
  // 5. Launch opencode
  await launchOpenCode(attachUrl);
}
```

## Auth Validation (state/auth.ts)

```typescript
import { createSyncClient } from "@proliferate/gateway-sdk";

export async function ensureAuth(): Promise<Auth> {
  const stored = loadAuth();
  
  if (!stored) {
    // No auth — run device flow
    return await deviceFlow();
  }
  
  // Auth exists — verify it's still valid via gateway health check
  const client = createSyncClient({
    baseUrl: GATEWAY_URL,
    auth: { type: "token", token: stored.token },
  });
  
  const health = await client.checkHealth();
  
  if (!health.ok) {
    // Token expired — clear and re-auth
    clearAuth();
    console.log("Session expired. Please log in again.");
    return await deviceFlow();
  }
  
  return stored;
}
```

## Gateway Integration

Everything goes through gateway-sdk — session creation, sandbox info, health checks:

```typescript
// main.ts
import { createSyncClient, createOpenCodeClient } from "@proliferate/gateway-sdk";

// ... after auth + config ...

// Create gateway client
const client = createSyncClient({
  baseUrl: GATEWAY_URL,
  auth: { type: "token", token: auth.token },
  source: "cli",
});

// Create session via gateway
const session = await client.createSession({
  organizationId: auth.org.id,
  cliPrebuild: { localPathHash: hashPath(cwd), displayName: basename(cwd) },
  sessionType: "cli",
  clientType: "cli",
  sandboxMode: "immediate",
  sshOptions: {
    publicKeys: [getSSHPublicKey()],
  },
});

// Get sandbox info (waits for sandbox to be ready)
const info = await client.getInfo(session.sessionId);

// Sync workspace
await sync(cwd, { host: info.sshHost!, port: info.sshPort! });

// Get OpenCode attach URL
const opencode = createOpenCodeClient({
  baseUrl: GATEWAY_URL,
  sessionId: session.sessionId,
  auth: { type: "token", token: auth.token },
});

// Launch opencode
await launchOpenCode(opencode.getUrl());
```

## What Gets Deleted

- `commands/` directory — replaced by single `main.ts`
- `lib/api.ts` — session creation now goes through gateway-sdk
- `lib/workspace/` — simplify into main flow
- `lib/device.ts`, `lib/focus.ts`, `lib/update.ts` — inline or delete

## Migration

1. Create `main.ts` with the simple flow using gateway-sdk
2. Move auth logic to `state/auth.ts` (device flow + health check)
3. Move config logic to `state/config.ts`
4. Split sync.ts → `sync/rsync.ts` + `sync/sources.ts`
5. Move opencode to `agents/opencode.ts`
6. Simplify `index.ts` to just parse `reset` vs default
7. Delete `commands/` and `lib/api.ts`
