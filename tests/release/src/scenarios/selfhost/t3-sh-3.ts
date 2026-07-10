import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import type { ScenarioDefinition } from "../types.js";

/**
 * T3-SH-3 — model gateway add-on: the agent's model backend works on a
 * self-hosted box.
 * specs/developing/testing/self-hosting.md#T3-SH-3
 *
 * What "the agent works" reduces to on a self-hosted box: the LiteLLM gateway
 * add-on (`--profile agent-gateway`) is serving a real model to agent traffic.
 * This asserts exactly that against the STANDING alpha box, read-plus-additive:
 *
 *  1. (when SSH is available) the gateway add-on is UP on the box — the
 *     profiled `litellm` service is running and healthy, the api reports
 *     `AGENT_GATEWAY_ENABLED=true`, and LiteLLM serves a model list that
 *     includes the cheapest model. Read-only `docker ...` inspection; nothing
 *     is brought up, torn down, or written (the gateway is a permanent add-on
 *     on the standing box and other work depends on it staying up).
 *  2. a REAL cheapest-model completion through the gateway's PUBLIC inference
 *     endpoint (the Caddy `/llm/*` route on the standing box) returns a real,
 *     non-empty, token-consuming response — the no-mock-LLM assertion.
 *
 * Env: RELEASE_E2E_SELFHOST_URL (the standing box) + RELEASE_E2E_GATEWAY_TEST_KEY
 * (the LiteLLM key to call the public endpoint with) are required — blocked
 * without either. RELEASE_E2E_SELFHOST_SSH[_KEY] are optional and only add the
 * on-box health assertions of step 1; the real-completion assertion runs with
 * URL + key alone.
 *
 * Deviation from the merged stub (for the #1078 owner): the stub assumed the
 * gateway starts DOWN, brought it up with `--profile agent-gateway up -d` after
 * writing an AGENT_GATEWAY / ANTHROPIC_API_KEY env block into `.env.static`, and
 * tore it back down in a finally. Against a standing box whose gateway is an
 * always-on add-on (and is actively serving other traffic), that bring-up /
 * teardown is destructive. This verifies the standing add-on's state instead
 * and never mutates the box. The stub also assumed a `/gateway` public path and
 * a `~/proliferate/deploy` install dir; the real box routes the gateway at
 * `/llm` (Caddy `handle_path /llm/*`), which is the derivation default here.
 * The full product-API path (admin login -> workspace -> session -> agent turn
 * inside a real E2B sandbox routed through the gateway) is the same slice
 * T3-CHAT-1's sandbox lane leaves unimplemented (needs a running durable
 * sandbox + publicly reachable callback URL, tracked #1042); the gateway
 * completion here is the spec's actual "agent request through the gateway ->
 * real response" assertion.
 */

// Cheapest model the standing gateway routes (verified live 2026-07-09: the
// LiteLLM /v1/models list includes `claude-haiku-4-5`). Overridable.
const DEFAULT_MODEL = "claude-haiku-4-5";

export const t3Sh3: ScenarioDefinition = {
  id: "T3-SH-3",
  title: "model gateway add-on: --profile agent-gateway + real completion",
  registryFlowRef: "specs/developing/testing/self-hosting.md#T3-SH-3",
  lanes: ["local"],
  requiredEnv: ["RELEASE_E2E_SELFHOST_URL", "RELEASE_E2E_GATEWAY_TEST_KEY"],
  plan: () => [
    { description: "(SSH, read-only) assert the profiled litellm service is running + healthy and the api reports AGENT_GATEWAY_ENABLED=true" },
    { description: "(SSH, read-only) assert LiteLLM serves a model list including the cheapest model" },
    { description: "POST a cheapest-model chat completion through the public gateway URL (Caddy /llm route); assert a real, non-empty, token-consuming response" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    const baseUrl = ctx.env.require("RELEASE_E2E_SELFHOST_URL").replace(/\/+$/, "");
    const testKey = ctx.env.require("RELEASE_E2E_GATEWAY_TEST_KEY");
    const model = process.env.RELEASE_E2E_SELFHOST_GATEWAY_MODEL?.trim() || DEFAULT_MODEL;
    const publicBase = (
      process.env.RELEASE_E2E_SELFHOST_GATEWAY_PUBLIC_URL?.trim() || `${baseUrl}/llm`
    ).replace(/\/+$/, "");

    const sshDest = process.env.RELEASE_E2E_SELFHOST_SSH?.trim();
    const sshKey = process.env.RELEASE_E2E_SELFHOST_SSH_KEY?.trim();
    if (sshDest && sshKey) {
      assertGatewayAddonUp(sshDest, sshKey, model);
    } else {
      console.log(
        "[T3-SH-3] RELEASE_E2E_SELFHOST_SSH[_KEY] not set — skipping the on-box gateway health " +
          "assertions; running the public-endpoint real completion only.",
      );
    }

    await assertRealCompletion(publicBase, testKey, model);
  },
};

/**
 * Read-only assertion that the `--profile agent-gateway` add-on is up on the
 * standing box: the profiled litellm service is running + healthy, the api
 * reports AGENT_GATEWAY_ENABLED=true, and LiteLLM serves the target model.
 * Never mutates the box (no compose up/down, no env writes).
 */
function assertGatewayAddonUp(sshDest: string, keyPath: string, model: string): void {
  const litellmContainer = sshExec(
    sshDest,
    keyPath,
    "sudo docker ps --filter label=com.docker.compose.service=litellm --format '{{.Names}}' | head -n1",
  ).trim();
  assert.ok(
    litellmContainer.length > 0,
    "T3-SH-3: no running litellm container found on the box — the --profile agent-gateway service is not up",
  );

  const health = sshExec(
    sshDest,
    keyPath,
    `sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' ${litellmContainer}`,
  ).trim();
  assert.equal(health, "healthy", `T3-SH-3: litellm container is not healthy (state=${health})`);

  const apiContainer = sshExec(
    sshDest,
    keyPath,
    "sudo docker ps --filter label=com.docker.compose.service=api --format '{{.Names}}' | head -n1",
  ).trim();
  assert.ok(apiContainer.length > 0, "T3-SH-3: no running api container found on the box");
  const gatewayEnabled = sshExec(
    sshDest,
    keyPath,
    `sudo docker exec ${apiContainer} printenv AGENT_GATEWAY_ENABLED 2>/dev/null || true`,
  ).trim();
  assert.equal(
    gatewayEnabled,
    "true",
    `T3-SH-3: the api does not report AGENT_GATEWAY_ENABLED=true (got ${JSON.stringify(gatewayEnabled)})`,
  );

  // LiteLLM's own model list (queried inside the compose network with the
  // master key from the container's own env — never printed) must include the
  // model we are about to call.
  const modelsOut = sshExec(
    sshDest,
    keyPath,
    `sudo docker exec ${litellmContainer} python3 -c "import os,json,urllib.request; ` +
      `req=urllib.request.Request('http://127.0.0.1:4000/v1/models', headers={'Authorization':'Bearer '+os.environ['LITELLM_MASTER_KEY']}); ` +
      `print(json.dumps([m['id'] for m in json.load(urllib.request.urlopen(req,timeout=5))['data']]))"`,
  );
  let servedModels: string[] = [];
  try {
    servedModels = JSON.parse(modelsOut.trim());
  } catch {
    assert.fail(`T3-SH-3: could not parse the LiteLLM model list: ${modelsOut.slice(0, 200)}`);
  }
  assert.ok(
    servedModels.includes(model),
    `T3-SH-3: the gateway does not serve the target model ${model}; served: ${servedModels.slice(0, 8).join(", ")}...`,
  );
  console.log(
    `[T3-SH-3] gateway add-on up: ${litellmContainer} healthy, api AGENT_GATEWAY_ENABLED=true, ` +
      `${servedModels.length} models served (incl. ${model}).`,
  );
}

/** Real cheapest-model completion through the public gateway inference URL. */
async function assertRealCompletion(publicBase: string, key: string, model: string): Promise<void> {
  const started = Date.now();
  const res = await fetch(`${publicBase}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      max_tokens: 16,
    }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, `T3-SH-3: gateway completion failed ${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };
  const content = body.choices?.[0]?.message?.content ?? "";
  assert.ok(content.trim().length > 0, `T3-SH-3: gateway returned an empty completion: ${text.slice(0, 300)}`);
  // A real call consumes tokens — guards against a mocked/short-circuited route.
  assert.ok(
    (body.usage?.total_tokens ?? 0) > 0,
    `T3-SH-3: gateway completion reported no token usage (looks mocked): ${text.slice(0, 300)}`,
  );
  console.log(
    `[T3-SH-3] real completion through the self-hosted gateway (${body.model ?? model}, ` +
      `${body.usage?.total_tokens} tokens, ${Date.now() - started}ms): ${content.trim().slice(0, 40)}`,
  );
}

function sshExec(dest: string, keyPath: string, command: string): string {
  const result = spawnSync(
    "ssh",
    [
      "-i",
      keyPath,
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "ConnectTimeout=15",
      dest,
      command,
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  if (result.status !== 0) {
    throw new Error(
      `T3-SH-3: ssh command failed (${result.status}): ${result.stderr?.trim() || result.stdout?.trim()}`,
    );
  }
  return result.stdout ?? "";
}
