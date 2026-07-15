import assert from "node:assert/strict";
import { test } from "node:test";

import {
  connectServerTrustFlow,
  connectProbePageUrl,
  assertRejectsInvalidUrl,
  assertRejectsNonProliferateHost,
  assertOnlyMetaFetchedBeforeTrust,
  normalizeConnectUrl,
  isServerMetaShape,
  ConnectServerRejectedError,
  type ConnectServerProbe,
  type ServerMetaShape,
} from "./connect-server.js";
import { CONNECT_PROBE_PATH } from "../worlds/local-workspace/processes.js";
import type { ProductPage } from "./product-page.js";

const PAGE = {} as ProductPage;

function meta(overrides: Partial<ServerMetaShape> = {}): ServerMetaShape {
  return {
    serverVersion: "1.2.3",
    desktopVersion: "1.2.3",
    runtimeVersion: "1.2.3",
    workerVersion: "1.2.3",
    minDesktopVersion: "1.0.0",
    ...overrides,
  };
}

/** A probe that returns a fixed `/meta` outcome and records the origins it was asked to fetch. */
function fakeProbe(config: {
  status: number;
  body: unknown;
  requests?: Array<{ method: string; path: string }>;
}): { probe: ConnectServerProbe; fetched: string[] } {
  const fetched: string[] = [];
  const probe: ConnectServerProbe = {
    fetchMeta: async (_page, origin) => {
      fetched.push(origin);
      return { status: config.status, body: config.body };
    },
    requestsToOrigin: () => config.requests ?? [{ method: "GET", path: "/meta" }],
  };
  return { probe, fetched };
}

test("normalizeConnectUrl defaults https, strips trailing slash, and rejects blank/invalid/non-http", () => {
  assert.deepEqual(normalizeConnectUrl("run.qualification.proliferate.com"), {
    ok: true,
    url: "https://run.qualification.proliferate.com",
    origin: "https://run.qualification.proliferate.com",
    host: "run.qualification.proliferate.com",
  });
  assert.equal((normalizeConnectUrl("https://host.example.com/") as { url: string }).url, "https://host.example.com");
  assert.equal(normalizeConnectUrl("   ").ok, false);
  // Prepends https:// then fails to parse (a space is never a valid host),
  // exercising the same parse-error branch the product's normalizeServerUrl has.
  assert.equal(normalizeConnectUrl("not a url at all").ok, false);
  assert.equal(normalizeConnectUrl("ftp://host.example.com").ok, false);
});

test("connectProbePageUrl points at the bare same-origin probe path on the renderer origin", () => {
  assert.equal(
    connectProbePageUrl("http://127.0.0.1:6100"),
    `http://127.0.0.1:6100${CONNECT_PROBE_PATH}`,
  );
  // A trailing slash on the renderer base URL never produces a doubled slash.
  assert.equal(
    connectProbePageUrl("http://127.0.0.1:6100/"),
    `http://127.0.0.1:6100${CONNECT_PROBE_PATH}`,
  );
  // The probe path is a bare .html document path, not the SPA index/root.
  assert.match(CONNECT_PROBE_PATH, /^\/[^/]+\.html$/);
});

test("isServerMetaShape only accepts a full MetaResponse", () => {
  assert.equal(isServerMetaShape(meta()), true);
  assert.equal(isServerMetaShape({ serverVersion: "1" }), false);
  assert.equal(isServerMetaShape("<html>ok</html>"), false);
  assert.equal(isServerMetaShape(null), false);
});

test("connectServerTrustFlow returns the /meta serverVersion for a healthy Proliferate instance", async () => {
  const { probe, fetched } = fakeProbe({ status: 200, body: meta({ serverVersion: "9.9.9" }) });
  const result = await connectServerTrustFlow(PAGE, "run.qualification.proliferate.com", {}, probe);
  assert.deepEqual(result, { trusted: true, meta: { serverVersion: "9.9.9" } });
  assert.deepEqual(fetched, ["https://run.qualification.proliferate.com"]);
});

test("connectServerTrustFlow rejects a syntactically invalid URL before any /meta fetch", async () => {
  const { probe, fetched } = fakeProbe({ status: 200, body: meta() });
  await assert.rejects(
    () => connectServerTrustFlow(PAGE, "   ", {}, probe),
    (error: unknown) => error instanceof ConnectServerRejectedError,
  );
  assert.equal(fetched.length, 0);
});

test("connectServerTrustFlow rejects a non-200 host and a healthy non-Proliferate host", async () => {
  const { probe: down } = fakeProbe({ status: 502, body: "bad gateway" });
  await assert.rejects(
    () => connectServerTrustFlow(PAGE, "https://down.example.com", {}, down),
    /not a Proliferate server \(\/meta returned 502\)/,
  );

  const { probe: wrongShape } = fakeProbe({ status: 200, body: { hello: "world" } });
  await assert.rejects(
    () => connectServerTrustFlow(PAGE, "https://nginx.example.com", {}, wrongShape),
    /not a Proliferate server \(\/meta is not a MetaResponse\)/,
  );
});

test("assertRejectsInvalidUrl passes for an unparseable address and never fetches /meta", async () => {
  const { probe, fetched } = fakeProbe({ status: 200, body: meta() });
  await assert.doesNotReject(() => assertRejectsInvalidUrl(PAGE, "not a url ::: %%%", probe));
  assert.equal(fetched.length, 0);
});

test("assertRejectsInvalidUrl fails if the flow would accept the address", async () => {
  const { probe } = fakeProbe({ status: 200, body: meta() });
  await assert.rejects(
    () => assertRejectsInvalidUrl(PAGE, "https://valid.example.com", probe),
    /expected .* to be rejected as invalid/,
  );
});

test("assertRejectsNonProliferateHost passes when a healthy non-Proliferate host is rejected", async () => {
  const { probe } = fakeProbe({ status: 200, body: { title: "some other app" } });
  await assert.doesNotReject(() => assertRejectsNonProliferateHost(PAGE, "https://healthy-but-wrong.example.com", probe));
});

test("assertRejectsNonProliferateHost fails when a non-Proliferate host is accepted before trust", async () => {
  const { probe } = fakeProbe({ status: 200, body: meta() });
  await assert.rejects(
    () => assertRejectsNonProliferateHost(PAGE, "https://actually-proliferate.example.com", probe),
    /was accepted before trust/,
  );
});

test("assertRejectsNonProliferateHost treats an unreachable/CORS-blocked /meta as a rejection", async () => {
  // A real non-Proliferate host (e.g. example.com) has no permissive CORS on
  // /meta, so the browser fetch throws "Failed to fetch". That is a rejection
  // (not a reachable Proliferate server), not an unhandled error.
  const probe = {
    fetchMeta: async () => {
      throw new TypeError("Failed to fetch");
    },
    requestsToOrigin: () => [],
  };
  await assert.doesNotReject(() => assertRejectsNonProliferateHost(PAGE, "https://blocked.example.com", probe));
});

test("assertOnlyMetaFetchedBeforeTrust passes when the only request to the origin is GET /meta", async () => {
  const { probe } = fakeProbe({ status: 200, body: meta(), requests: [{ method: "GET", path: "/meta" }] });
  await assert.doesNotReject(() =>
    assertOnlyMetaFetchedBeforeTrust(PAGE, "run.qualification.proliferate.com", probe),
  );
});

test("assertOnlyMetaFetchedBeforeTrust fails when any non-/meta request is issued before trust", async () => {
  const { probe } = fakeProbe({
    status: 200,
    body: meta(),
    requests: [
      { method: "GET", path: "/meta" },
      { method: "POST", path: "/auth/desktop/password/login" },
    ],
  });
  await assert.rejects(
    () => assertOnlyMetaFetchedBeforeTrust(PAGE, "run.qualification.proliferate.com", probe),
    /also saw: POST \/auth\/desktop\/password\/login/,
  );
});

test("assertOnlyMetaFetchedBeforeTrust fails when no request to the origin was observed", async () => {
  const { probe } = fakeProbe({ status: 200, body: meta(), requests: [] });
  await assert.rejects(
    () => assertOnlyMetaFetchedBeforeTrust(PAGE, "run.qualification.proliferate.com", probe),
    /no request to .* was observed/,
  );
});
