import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError } from "../types.js";

/**
 * T3-SH-3 — model gateway add-on.
 * specs/developing/testing/self-hosting.md#T3-SH-3
 *
 * On the standing self-hosted box: turn on the LiteLLM gateway the two-step way
 * an operator does — set the AGENT_GATEWAY / LITELLM env block, then bring up
 * the profiled services with `docker compose --profile agent-gateway up -d`
 * (env alone does nothing; sharp edge §7) — then make a REAL agent request
 * through the gateway's public inference endpoint on the cheapest model and
 * assert a real, non-empty completion (consistent with the no-mock-LLM ruling).
 * Brings the gateway back down in a finally so the standing box's steady state
 * is unchanged (additive use).
 *
 * Needs SSH to the box (a compose profile cannot be toggled over HTTP) plus real
 * keys: RELEASE_E2E_GATEWAY_TEST_KEY (the LiteLLM master/virtual key to call
 * with) and a provider key the gateway routes (RELEASE_E2E_SELFHOST_GATEWAY_
 * PROVIDER_KEY, an Anthropic key). Without any of these it reports blocked —
 * matching the standing state that no gateway test infra is provisioned yet
 * (~/notes/testing-open-rulings.md: staging has no deployed LiteLLM).
 */

// Cheapest Anthropic model family the gateway can route (AI title model in the
// env example); overridable for a different cheap model.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export const t3Sh3: ScenarioDefinition = {
  id: "T3-SH-3",
  title: "model gateway add-on: --profile agent-gateway + real completion",
  registryFlowRef: "specs/developing/testing/self-hosting.md#T3-SH-3",
  lanes: ["local"],
  requiredEnv: [
    "RELEASE_E2E_SELFHOST_URL",
    "RELEASE_E2E_SELFHOST_SSH",
    "RELEASE_E2E_SELFHOST_SSH_KEY",
    "RELEASE_E2E_GATEWAY_TEST_KEY",
  ],
  plan: () => [
    { description: "SSH to the standing box; write the AGENT_GATEWAY_*/LITELLM_* env block into .env.static" },
    { description: "docker compose --profile agent-gateway up -d (litellm + litellm-db)" },
    { description: "wait for the gateway /health/liveliness" },
    { description: "POST a cheapest-model chat completion through the public gateway URL; assert a real response" },
    { description: "bring the gateway back down (finally) — additive use of the standing box" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    const providerKey = process.env.RELEASE_E2E_SELFHOST_GATEWAY_PROVIDER_KEY?.trim();
    if (!providerKey) {
      throw new ScenarioBlockedError(
        "T3-SH-3: a provider key the gateway can route is required for a real (no-mock) completion. Set " +
          "RELEASE_E2E_SELFHOST_GATEWAY_PROVIDER_KEY (an Anthropic API key). Absent — the standing test " +
          "infra has no gateway provider key provisioned yet (see ~/notes/testing-open-rulings.md).",
      );
    }
    await runReal(ctx.env.require("RELEASE_E2E_GATEWAY_TEST_KEY"), providerKey);
  },
};

async function runReal(masterKey: string, providerKey: string): Promise<void> {
  const sshDest = requireEnv("RELEASE_E2E_SELFHOST_SSH");
  const keyPath = requireEnv("RELEASE_E2E_SELFHOST_SSH_KEY");
  const model = process.env.RELEASE_E2E_SELFHOST_GATEWAY_MODEL?.trim() || DEFAULT_MODEL;
  // Derive the gateway public base URL from the box URL unless overridden.
  const publicBase =
    process.env.RELEASE_E2E_SELFHOST_GATEWAY_PUBLIC_URL?.trim() ||
    `${requireEnv("RELEASE_E2E_SELFHOST_URL").replace(/\/+$/, "")}/gateway`;

  const litellmPgPassword = randomHex(16);
  const envBlock = [
    "AGENT_GATEWAY_ENABLED=true",
    "AGENT_GATEWAY_LITELLM_BASE_URL=http://litellm:4000",
    `AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL=${publicBase}`,
    `AGENT_GATEWAY_LITELLM_MASTER_KEY=${masterKey}`,
    `LITELLM_MASTER_KEY=${masterKey}`,
    `LITELLM_POSTGRES_PASSWORD=${litellmPgPassword}`,
    `ANTHROPIC_API_KEY=${providerKey}`,
  ].join("\n");

  try {
    // Append the gateway env to the operator's source-of-truth .env.static, then
    // regenerate the runtime env and bring up the profiled services.
    sshExec(
      sshDest,
      keyPath,
      `cd ~/proliferate/deploy && sudo bash -c 'cat >> .env.static' <<'GWENV'\n${envBlock}\nGWENV`,
    );
    sshExec(
      sshDest,
      keyPath,
      "cd ~/proliferate/deploy && sudo ./ensure-secrets.sh && " +
        "sudo PROLIFERATE_ENV_FILE=.env.runtime docker compose --env-file .env.runtime -f docker-compose.production.yml --profile agent-gateway up -d",
    );

    // Wait for the gateway to report liveliness (inside the compose network).
    let live = false;
    for (let i = 0; i < 24; i += 1) {
      const out = sshExec(
        sshDest,
        keyPath,
        "cd ~/proliferate/deploy && sudo PROLIFERATE_ENV_FILE=.env.runtime docker compose --env-file .env.runtime -f docker-compose.production.yml " +
          "exec -T litellm python3 -c \"import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:4000/health/liveliness',timeout=3).status)\" 2>/dev/null || true",
      );
      if (out.includes("200")) {
        live = true;
        break;
      }
      await sleep(5000);
    }
    assert.ok(live, "T3-SH-3: the LiteLLM gateway never reported liveliness after --profile agent-gateway up");

    // Real completion through the public gateway URL (OpenAI-compatible route).
    const res = await fetch(`${publicBase.replace(/\/+$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${masterKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        max_tokens: 16,
      }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, `T3-SH-3: gateway completion failed ${res.status}: ${text.slice(0, 300)}`);
    const body = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content ?? "";
    assert.ok(content.trim().length > 0, `T3-SH-3: gateway returned an empty completion: ${text.slice(0, 300)}`);
    console.log(`[T3-SH-3] real completion through the self-hosted gateway (${model}): ${content.trim().slice(0, 40)}`);
  } finally {
    // Additive use: take the gateway back down and restore .env.static so the
    // standing box returns to its steady state.
    try {
      sshExec(
        sshDest,
        keyPath,
        "cd ~/proliferate/deploy && " +
          "sudo PROLIFERATE_ENV_FILE=.env.runtime docker compose --env-file .env.runtime -f docker-compose.production.yml --profile agent-gateway stop litellm litellm-db && " +
          "sudo PROLIFERATE_ENV_FILE=.env.runtime docker compose --env-file .env.runtime -f docker-compose.production.yml rm -f litellm litellm-db && " +
          "sudo sed -i '/^AGENT_GATEWAY_ENABLED=/d;/^AGENT_GATEWAY_LITELLM_/d;/^LITELLM_/d;/^ANTHROPIC_API_KEY=/d' .env.static",
      );
    } catch (error) {
      console.error(
        `[T3-SH-3] WARNING: could not fully tear the gateway back down on the standing box: ` +
          `${error instanceof Error ? error.message : String(error)}. Bring it down manually.`,
      );
    }
  }
}

function sshExec(dest: string, keyPath: string, command: string): string {
  const result = spawnSync(
    "ssh",
    ["-i", keyPath, "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ConnectTimeout=15", dest, command],
    { encoding: "utf8", timeout: 5 * 60_000 },
  );
  if (result.status !== 0) {
    throw new Error(`T3-SH-3: ssh command failed (${result.status}): ${result.stderr?.trim() || result.stdout?.trim()}`);
  }
  return result.stdout ?? "";
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ScenarioBlockedError(`T3-SH-3: ${name} is required.`);
  }
  return value;
}

function randomHex(bytes: number): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
