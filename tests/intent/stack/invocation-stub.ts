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

export async function startInvocationStub(options: InvocationStubOptions = {}): Promise<InvocationStubServer> {
  const apiKey = options.apiKey ?? DEFAULT_INVOCATION_STUB_API_KEY;
  const requests: RecordedInvocationRequest[] = [];
  let nextId = 1;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/__requests") {
        await handleRequestsControl(request, response, requests);
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
