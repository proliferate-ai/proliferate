# Gateway SDK

Typed clients for interacting with the Proliferate Gateway.

## Overview

The SDK provides three client types:

| Client | Transport | Use Case |
|--------|-----------|----------|
| **SyncClient** | WebSocket + HTTP | Web UI, real-time |
| **AsyncClient** | BullMQ queues | Slack, Discord, async platforms |
| **OpenCodeClient** | HTTP proxy | CLI direct OpenCode access |

All clients share a common `Client` interface with capabilities (e.g. verification tools).

## File Structure

```
gateway-sdk/src/
├── index.ts                    # Browser-safe exports
├── server.ts                   # Server-only exports (AsyncClient, BullMQ)
├── client.ts                   # Base Client interface
├── types.ts                    # Shared types
├── auth/
│   └── index.ts                # Token signing, auth config
├── capabilities/
│   └── tools/
│       ├── index.ts
│       └── verify.ts           # Verification file access
└── clients/
    ├── sync/
    │   ├── index.ts            # createSyncClient()
    │   ├── websocket.ts        # WebSocket + reconnection
    │   └── http.ts             # HTTP methods
    ├── async/
    │   ├── index.ts            # AsyncClient abstract class
    │   ├── receiver.ts         # runReceiver()
    │   └── types.ts
    └── external/
        ├── base.ts             # ExternalClient base
        ├── index.ts
        └── opencode.ts         # OpenCodeClient
```

## Gateway Routes

```
WebSocket:
  /proliferate/:proliferateSessionId

HTTP:
  GET  /proliferate/:proliferateSessionId
  POST /proliferate/:proliferateSessionId/message
  POST /proliferate/:proliferateSessionId/cancel
  GET  /proliferate/:proliferateSessionId/verification-media

Proxy:
  /proxy/:proliferateSessionId/:token/opencode/*
```

## Client Interface

All clients implement the base `Client` interface:

```typescript
interface Client {
  readonly type: "sync" | "async" | "external";

  checkHealth(): Promise<{ ok: boolean; latencyMs?: number }>;

  readonly tools: {
    verification: {
      list(proliferateSessionId: string, options?: { prefix?: string }): Promise<VerificationFile[]>;
      getUrl(proliferateSessionId: string, key: string): Promise<string>;
      getStream(proliferateSessionId: string, key: string): Promise<{ data: ArrayBuffer; contentType: string }>;
    };
  };
}
```

Type guards: `isSyncClient()`, `isAsyncClient()`, `isExternalClient()`

## SyncClient

Real-time WebSocket + HTTP client. Browser-safe.

```typescript
import { createSyncClient } from "@proliferate/gateway-sdk";

const client = createSyncClient({
  baseUrl: "https://gateway.example.com",
  auth: { type: "token", token: userToken },
  source: "web", // optional: for filtering events
});

// WebSocket
const ws = client.connect(proliferateSessionId, {
  onEvent: (event) => console.log(event),
  onOpen: () => console.log("connected"),
  onClose: (code, reason) => console.log("closed"),
  onReconnect: (attempt) => console.log(`reconnecting ${attempt}`),
  onReconnectFailed: () => console.log("gave up"),
});

ws.sendPrompt("Hello");
ws.sendCancel();
ws.sendPing();
ws.sendSaveSnapshot("checkpoint");
ws.close();

// HTTP
await client.postMessage(proliferateSessionId, { content: "Hello" });
await client.postCancel(proliferateSessionId);
const info = await client.getInfo(proliferateSessionId);

// Verification files
const files = await client.tools.verification.list(proliferateSessionId, { prefix: "screenshots/" });
const url = await client.tools.verification.getUrl(proliferateSessionId, key);
```

### Auth Options

```typescript
// User token (browser)
{ type: "token", token: "jwt-from-api" }

// Service auth (workers, API routes) — SDK signs JWT
{ type: "service", name: "slack-worker", secret: "shared-secret" }
```

## OpenCodeClient

Passthrough to OpenCode via gateway proxy. Browser-safe.

```typescript
import { createOpenCodeClient } from "@proliferate/gateway-sdk";

const client = createOpenCodeClient({
  baseUrl: "https://gateway.example.com",
  auth: { type: "token", token: userToken },
});

// Get proxy URL
const url = await client.getUrl(proliferateSessionId);
// → "https://gateway.example.com/proxy/{id}/{token}/opencode"

// Use directly
const response = await fetch(`${url}/session`);
const eventSource = new EventSource(`${url}/events`);

// Verification still works
const files = await client.tools.verification.list(proliferateSessionId);
```

## AsyncClient

BullMQ-based client for async platforms. Server-only.

```typescript
import { AsyncClient } from "@proliferate/gateway-sdk/server";
import { createSyncClient } from "@proliferate/gateway-sdk";

class SlackClient extends AsyncClient<SlackMetadata, SlackInbound, SlackReceiver> {
  readonly clientType = "slack";

  async processInbound(job: SlackInbound): Promise<void> {
    // Handle incoming Slack message
    await this.syncClient.postMessage(sessionId, { content, userId });
  }

  async handleEvent(
    proliferateSessionId: string,
    metadata: SlackMetadata,
    event: ServerMessage
  ): Promise<"continue" | "stop"> {
    // Handle gateway event, post to Slack
    const files = await this.tools.verification.list(proliferateSessionId);
    return "continue"; // or "stop" to close receiver
  }
}

// Setup
const syncClient = createSyncClient({ baseUrl, auth });
const slackClient = new SlackClient({ syncClient });
slackClient.setup({
  connection: redisConnection,
  inboundConcurrency: 5,
  receiverConcurrency: 10,
});

// Wake receiver for a session
await slackClient.wake(proliferateSessionId, metadata, source);
```

## Exports

### `@proliferate/gateway-sdk` (browser-safe)

```typescript
// Clients
createSyncClient, SyncClient, SyncClientOptions
createOpenCodeClient, OpenCodeClient, OpenCodeClientOptions
ExternalClient, ExternalClientBase

// Base interface
Client, ClientTools, VerificationTools
isSyncClient, isAsyncClient, isExternalClient

// Auth
ServiceAuth, TokenAuth, GatewayAuth

// Types
VerificationFile, ConnectionOptions, ReconnectOptions
PostMessageOptions, HealthCheckResult, SandboxInfo
SyncWebSocket, WebSocketOptions

// Message types (from @proliferate/shared)
ServerMessage, ClientMessage, Message, InitMessage, TokenMessage, ...
```

### `@proliferate/gateway-sdk/server` (Node.js only)

```typescript
AsyncClient
runReceiver
WakeableClient
AsyncClientDeps, AsyncClientSetupOptions, ReceiverOptions
```

## Verification Files

When the agent runs the `verify` tool (screenshots), files are uploaded to S3. The SDK provides methods to list and download them:

```typescript
// List files with optional prefix filter
const files = await client.tools.verification.list(proliferateSessionId, {
  prefix: "screenshots/step-1/",
});
// → [{ key, name, path, contentType, size, lastModified }, ...]

// Get presigned URL (1-hour expiry)
const url = await client.tools.verification.getUrl(proliferateSessionId, key);

// Get file content directly
const { data, contentType } = await client.tools.verification.getStream(proliferateSessionId, key);
```
