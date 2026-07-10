import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../types.js";
import { ApiRequestError } from "../../fixtures/http.js";
import {
  archiveWorkflow,
  createTrigger,
  createWorkflow,
  inspectPoll,
  listTriggerItems,
  openDurableWorkflowClient,
  readWorkflowFixture,
} from "../../fixtures/workflows.js";

/**
 * T3-WF-5 — polls end-to-end (`wf-poll-feed`).
 * specs/developing/testing/scenarios.md#T3-WF-5
 *
 * Contract: /init inference at setup; item → inputs delivery; the cursor advances
 * exactly once per item; a replayed item spawns no second run.
 *
 * The /init inference is a pure, stateless server probe (POST
 * /v1/cloud/workflows/poll/inspect) that hits the endpoint's reserved /init path
 * and derives the inputs skeleton — no workflow, no DB, NO agent. That half runs
 * LIVE locally against a scenario-local stub feed (the SSRF guard is bypassed
 * under server debug, so a 127.0.0.1 stub is reachable). The item→inputs delivery
 * + cursor-advance + replay-dedup half needs a poll trigger, which requires a
 * server-derived cloud workspace from a repo pin (D16) and the runtime poller
 * loop; that is gated on a configured cloud repo environment + the running poller.
 */
export const t3Wf5: ScenarioDefinition = {
  id: "T3-WF-5",
  title: "polls end-to-end (/init inference + cursor)",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-WF-5",
  lanes: ["local"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
  ],
  plan: () => [
    { description: "stand up a scenario-local stub feed (poll contract: /init sample item + a paged feed)" },
    { description: "POST /v1/cloud/workflows/poll/inspect against the stub → assert derived inputs = {item_id, title}" },
    { description: "create wf-poll-feed + a poll trigger against the stub feed" },
    { description: "assert the trigger's seen-set advances the cursor exactly once per item (one trigger-item per id)" },
    { description: "replay the same item → assert no second run/trigger-item is created" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.targetLane === "staging") {
      throw new ScenarioBlockedError(
        "T3-WF-5/staging: deferred — creates a workflow/trigger against the SHARED durable user/org, and a " +
          "127.0.0.1 stub feed is not reachable from staging. Needs a publicly reachable stub + a non-shared " +
          "staging fixture.",
      );
    }

    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
    const client = await openDurableWorkflowClient(serverUrl);
    const feed = await startStubFeed();

    try {
      // (1) LIVE, no workflow/agent: the /init inference. Fails clean if the
      //     SSRF guard is not bypassed (server not in debug) — reported blocked.
      let inspection;
      try {
        inspection = await inspectPoll(client, { url: `${feed.baseUrl}/feed` });
      } catch (error) {
        if (error instanceof ApiRequestError && isPollBlocked(error)) {
          throw new ScenarioBlockedError(
            "T3-WF-5: the server refused to probe the 127.0.0.1 stub feed's /init (SSRF guard active — the server " +
              "is not running with debug on). Boot the local stack with DEBUG=true (the gatec profile default) so " +
              "the /init inference can run against a scenario-local stub.",
          );
        }
        throw error;
      }
      const derivedNames = inspection.derivedInputs.map((i) => i.name).sort();
      assert.deepEqual(
        derivedNames,
        ["item_id", "title"],
        `T3-WF-5: /init inference must derive {item_id, title} from the sample item (got ${JSON.stringify(derivedNames)})`,
      );
      assert.ok(inspection.sampleItemId, "T3-WF-5: /init inference must surface the sample item id");
      console.log(`[T3-WF-5] /init inference green: derived inputs ${JSON.stringify(derivedNames)}.`);

      // (2) The cursor/replay half needs a poll trigger + the running poller.
      const definition = await readWorkflowFixture("wf-poll-feed");
      const created = await createWorkflow(client, definition, { nameSuffix: "wf5" });
      try {
        let trigger;
        try {
          trigger = await createTrigger(client, created.workflow.id, {
            kind: "poll",
            concurrencyPolicy: "skip",
            targetMode: "personal_cloud",
            repoFullName: process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? "proliferate-e2e/e2e-fixture",
            poll: { url: `${feed.baseUrl}/feed`, intervalSecs: 60 },
          });
        } catch (error) {
          if (error instanceof ApiRequestError) {
            throw new ScenarioExpectedFailError(
              "T3-WF-5: /init inference verified live. The poll-trigger create failed " +
                `(${firstErrorLine(error)}) — a poll trigger derives its cloud workspace from a repo pin (D16), ` +
                "which needs a configured cloud repo environment for the durable user. The cursor-advance + " +
                "replay-dedup proof is gated on that + the running poller loop.",
            );
          }
          throw error;
        }
        // If the trigger created, the seen-set/cursor proof still needs the poller
        // to fire against the stub. The poller runs on its own cadence server-side.
        const items = await listTriggerItems(client, created.workflow.id, trigger.id);
        console.log(`[T3-WF-5] poll trigger created (${trigger.id}); seen-set size=${items.items.length}.`);
        throw new ScenarioExpectedFailError(
          "T3-WF-5: poll trigger created against the stub. Asserting cursor-advances-once-per-item + " +
            "replay-spawns-no-second-run needs the runtime poller loop to fire against the stub within the run " +
            "budget; the release runner does not yet drive/await the poller. The /init inference half is green.",
        );
      } finally {
        await archiveWorkflow(client, created.workflow.id);
      }
    } finally {
      await feed.close();
    }
  },
};

function isPollBlocked(error: ApiRequestError): boolean {
  const body = error.body as { code?: unknown; detail?: { code?: unknown } } | null;
  const code = typeof body?.code === "string" ? body.code : undefined;
  return code === "poll_endpoint_blocked" || /poll_endpoint_blocked|SSRF|blocked/i.test(String(body?.detail ?? ""));
}

function firstErrorLine(error: ApiRequestError): string {
  return `${error.status} ${JSON.stringify(error.body).slice(0, 200)}`;
}

// --- scenario-local stub feed (poll contract §4.2) ---

interface StubFeed {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startStubFeed(): Promise<StubFeed> {
  const sampleItem = {
    id: "poll-item-1",
    kind: "issue",
    occurred_at: new Date().toISOString(),
    data: { item_id: "poll-item-1", title: "Sample polled item" },
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/feed/init") {
      // Reserved /init: return one sample item so the inference derives inputs.
      sendJson(res, 200, { items: [sampleItem], cursor: "init", has_more: false });
      return;
    }
    if (url.pathname === "/feed") {
      // A poll cycle: one item, no more pages. Deterministic id → replay dedup.
      sendJson(res, 200, { items: [sampleItem], cursor: "c1", has_more: false });
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("stub feed did not bind a port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
