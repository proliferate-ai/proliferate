import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const DEFAULT_INVOCATION_STUB_API_KEY = "tier2-intent-invocation-key";

export interface RecordedInvocationRequest {
  id: number;
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
  receivedAt: string;
}

export interface InvocationStubServer {
  baseUrl: string;
  apiKey: string;
  requests: () => RecordedInvocationRequest[];
  clearRequests: () => void;
  close: () => Promise<void>;
}

interface InvocationStubOptions {
  apiKey?: string;
}

interface SampleInitItem {
  id: string;
  title: string;
  status: "ready";
}

// ── Poll-feed contract (spec 4.2/4.3) ──
// A conforming poll endpoint the workflows poller GETs. It serves a poll PAGE
// (`{items, cursor, has_more}`) at `/poll-feed`, and the reserved `/poll-feed/
// init` sample the workflow-from-poll (flow 1) + signature-probe (flow 2) paths
// read. Distinct from the invocation `/init` above (a different contract). These
// routes are handled BEFORE the invocation x-api-key gate: a poll trigger carries
// its own configured auth header (optional), not the invocation key.
//
// The feed replays the SAME three items on every poll so the seen-set dedup
// (workflow_trigger_item PK) is exercised: two valid items + one schema-invalid
// item (`count` typed wrong). The cursor is fixed, so it advances exactly once
// (NULL -> "cursor-1") and stays put on replay. `pollFeedFail` (toggled over HTTP
// via `/__poll-feed`) makes the feed 503 without killing the shared stub — the
// "point the trigger at a dead endpoint" case for last_poll_error, kept isolated
// from sibling specs that share this one stub.
const POLL_FEED_CURSOR = "cursor-1";

function pollFeedInitPage(): object {
  return {
    items: [
      {
        id: "poll-init-sample",
        kind: "issue",
        occurred_at: "2026-07-09T00:00:00Z",
        // Two scalar fields (derive to inputs) + one non-scalar (labels array,
        // reported as a skipped field by flow 1's derive).
        data: { issue_id: "sample-issue", count: 0, labels: ["bug"] },
      },
    ],
    cursor: POLL_FEED_CURSOR,
    has_more: false,
  };
}

function pollFeedPage(): object {
  return {
    items: [
      { id: "issue-1", kind: "issue", data: { issue_id: "issue-1", count: 1 } },
      { id: "issue-2", kind: "issue", data: { issue_id: "issue-2", count: 2 } },
      // Schema-invalid: `count` must be a number per the derived item schema.
      { id: "issue-bad", kind: "issue", data: { issue_id: "issue-3", count: "twelve" } },
    ],
    cursor: POLL_FEED_CURSOR,
    has_more: false,
  };
}

export async function startInvocationStub(options: InvocationStubOptions = {}): Promise<InvocationStubServer> {
  const apiKey = options.apiKey ?? DEFAULT_INVOCATION_STUB_API_KEY;
  const requests: RecordedInvocationRequest[] = [];
  let nextId = 1;
  let pollFeedFail = false;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/__requests") {
        await handleRequestsControl(request, response, requests);
        return;
      }

      // Poll-feed control: GET reports the fail flag; POST/DELETE toggle it.
      if (url.pathname === "/__poll-feed") {
        if (request.method === "GET") {
          sendJson(response, 200, { failing: pollFeedFail });
        } else if (request.method === "POST") {
          pollFeedFail = true;
          sendJson(response, 200, { failing: true });
        } else if (request.method === "DELETE") {
          pollFeedFail = false;
          sendJson(response, 200, { failing: false });
        } else {
          sendJson(response, 405, { error: "method_not_allowed" });
        }
        return;
      }

      // Poll-feed routes (no invocation api-key gate — a poll trigger carries its
      // own configured auth header). Reserved `/poll-feed/init` first.
      if (request.method === "GET" && url.pathname === "/poll-feed/init") {
        if (pollFeedFail) {
          sendJson(response, 503, { error: "poll_feed_down" });
          return;
        }
        sendJson(response, 200, pollFeedInitPage());
        return;
      }
      if (request.method === "GET" && url.pathname === "/poll-feed") {
        if (pollFeedFail) {
          sendJson(response, 503, { error: "poll_feed_down" });
          return;
        }
        sendJson(response, 200, pollFeedPage());
        return;
      }

      const recorded = await recordRequest(request, url, nextId++);
      requests.push(recorded);

      if (request.headers["x-api-key"] !== apiKey) {
        sendJson(response, 401, { error: "invalid_api_key" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/init") {
        sendJson(response, 200, { item: sampleInitItem() });
        return;
      }

      sendJson(response, 200, {
        ok: true,
        request: {
          id: recorded.id,
          method: recorded.method,
          path: recorded.path,
        },
      });
    } catch (error) {
      sendJson(response, 500, { error: String(error) });
    }
  });

  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Invocation stub did not bind to a TCP port.");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    apiKey,
    requests: () => [...requests],
    clearRequests: () => {
      requests.length = 0;
    },
    close: () => close(server),
  };
}

async function handleRequestsControl(
  request: IncomingMessage,
  response: ServerResponse,
  requests: RecordedInvocationRequest[],
): Promise<void> {
  if (request.method === "GET") {
    sendJson(response, 200, { requests });
    return;
  }
  if (request.method === "DELETE") {
    requests.length = 0;
    sendJson(response, 200, { ok: true });
    return;
  }
  sendJson(response, 405, { error: "method_not_allowed" });
}

async function recordRequest(
  request: IncomingMessage,
  url: URL,
  id: number,
): Promise<RecordedInvocationRequest> {
  return {
    id,
    method: request.method ?? "GET",
    path: `${url.pathname}${url.search}`,
    headers: request.headers,
    body: await readBody(request),
    receivedAt: new Date().toISOString(),
  };
}

function sampleInitItem(): SampleInitItem {
  return {
    id: "sample-item-1",
    title: "Sample invocation item",
    status: "ready",
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
