// T2-WF-3, T2-WF-4 (specs/developing/testing/scenarios.md): function-invocation
// CRUD (headers write-only, args-schema validation, reserved `functions`
// namespace) and the organization / chat default-access surface.
//
// No workflow is created here (invocations are person-scoped and the admin
// default-access surface is org policy), so the free-plan workflow cap is not in
// play. Everything drives the product's own HTTP surface:
//   - /v1/cloud/integrations/functions       (owner-scoped invocation CRUD)
//   - /v1/cloud/integrations/admin/...        (org admin default-access)
// The invocation `endpointUrl` points at the intent stub, but nothing dispatches
// a call in tier-2 (the gateway tool call is tier-3, T3-INT-1's territory), so no
// outbound request leaves the stack — CRUD validates shape only.
//
// Header write-only is a property of the response SCHEMA, not a runtime check:
// FunctionInvocationResponse only ever carries `hasHeaders` (a presence boolean),
// never header values, so "never echoed" is pinned by asserting the body has no
// `headers` field on create, list, rotate, and chat-scope round trips.

import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ensureInstanceClaimed,
  getOwnOrganization,
  passwordLogin,
} from "../stack/seed.ts";
import {
  archiveFunctionInvocation,
  createAdminIntegrationDefinition,
  createFunctionInvocation,
  invocationStubBaseUrl,
  listFunctionInvocations,
  rotateFunctionInvocationHeaders,
  setAdminIntegrationDefaultChatScope,
  setFunctionInvocationChatScope,
} from "../stack/seed-workflows.ts";

test.describe.configure({ mode: "serial" });

let ownerToken: string;
let organizationId: string;
let stubBaseUrl: string;

test.beforeAll(async () => {
  await ensureInstanceClaimed();
  ownerToken = (await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD)).access_token;
  organizationId = (await getOwnOrganization(ownerToken)).id;
  stubBaseUrl = invocationStubBaseUrl();
});

test.describe("T2-WF-3: function-invocation CRUD", () => {
  test("create with a valid args schema: workflow-only by default, no headers echoed", async () => {
    const name = `wf3_plain_${Date.now()}`;
    const result = await createFunctionInvocation(ownerToken, {
      name,
      endpointUrl: `${stubBaseUrl}/invoke`,
      method: "post",
      argsSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      displayName: "Search",
    });
    expect(result.status).toBe(200);
    expect(result.body.name).toBe(name);
    expect(result.body.method).toBe("post");
    // §2 default access: a new invocation is workflow-only until enabled for chat.
    expect(result.body.chatScopeEnabled).toBe(false);
    // No headers supplied → none stored, and no header values ever ride the wire.
    expect(result.body.hasHeaders).toBe(false);
    expect(result.body).not.toHaveProperty("headers");
  });

  test("headers are write-only: set on create, presence-only in list, still never echoed after rotate", async () => {
    const name = `wf3_hdr_${Date.now()}`;
    const created = await createFunctionInvocation(ownerToken, {
      name,
      endpointUrl: `${stubBaseUrl}/invoke`,
      method: "post",
      headers: { Authorization: "Bearer super-secret", "X-Trace": "abc" },
    });
    expect(created.status).toBe(200);
    expect(created.body.hasHeaders).toBe(true);
    expect(created.body).not.toHaveProperty("headers");

    // List never echoes header values either (presence flag only).
    const listed = await listFunctionInvocations(ownerToken);
    expect(listed.status).toBe(200);
    const row = listed.body.items.find((item) => item.name === name);
    expect(row).toBeDefined();
    expect(row?.hasHeaders).toBe(true);
    expect(row).not.toHaveProperty("headers");
    expect(JSON.stringify(listed.body)).not.toContain("super-secret");

    // Rotate (set again) → still write-only.
    const rotated = await rotateFunctionInvocationHeaders(ownerToken, name, {
      Authorization: "Bearer rotated-secret",
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.hasHeaders).toBe(true);
    expect(rotated.body).not.toHaveProperty("headers");
    expect(JSON.stringify(rotated.body)).not.toContain("rotated-secret");

    // Clear the ciphertext by rotating to null → hasHeaders flips false.
    const cleared = await rotateFunctionInvocationHeaders(ownerToken, name, null);
    expect(cleared.status).toBe(200);
    expect(cleared.body.hasHeaders).toBe(false);
  });

  test("a malformed args schema is rejected (invalid_payload)", async () => {
    const result = await createFunctionInvocation(ownerToken, {
      name: `wf3_badschema_${Date.now()}`,
      endpointUrl: `${stubBaseUrl}/invoke`,
      method: "post",
      // `type` must be a string/array of strings — a number is not valid JSON Schema.
      argsSchema: { type: 123 } as unknown as Record<string, unknown>,
    });
    expect(result.status).toBe(400);
    expect((result.body as { detail?: { code?: string } }).detail?.code).toBe("invalid_payload");
  });

  test("an invalid name is rejected (invalid_payload — the name is the gateway tool address)", async () => {
    const result = await createFunctionInvocation(ownerToken, {
      name: "Not A Valid Name",
      endpointUrl: `${stubBaseUrl}/invoke`,
      method: "post",
    });
    expect(result.status).toBe(400);
    expect((result.body as { detail?: { code?: string } }).detail?.code).toBe("invalid_payload");
  });

  test("the reserved `functions` namespace cannot be used for a custom org integration", async () => {
    const result = await createAdminIntegrationDefinition(ownerToken, organizationId, {
      displayName: "Colliding",
      namespace: "functions",
      mcpUrl: `${stubBaseUrl}/mcp`,
      authKind: "none",
    });
    expect(result.status).toBe(400);
    expect((result.body as { detail?: { code?: string } }).detail?.code).toBe("invalid_payload");
  });
});

test.describe("T2-WF-4: organization / chat default-access enforcement", () => {
  test("chat scope round-trips: workflow-only by default → enabled for chat → back", async () => {
    const name = `wf4_scope_${Date.now()}`;
    const created = await createFunctionInvocation(ownerToken, {
      name,
      endpointUrl: `${stubBaseUrl}/invoke`,
      method: "get",
    });
    expect(created.status).toBe(200);
    expect(created.body.chatScopeEnabled).toBe(false);

    const enabled = await setFunctionInvocationChatScope(ownerToken, name, true);
    expect(enabled.status).toBe(200);
    expect(enabled.body.chatScopeEnabled).toBe(true);

    // Persisted, visible on the list surface the settings UI renders.
    const listed = await listFunctionInvocations(ownerToken);
    expect(listed.body.items.find((item) => item.name === name)?.chatScopeEnabled).toBe(true);

    const disabled = await setFunctionInvocationChatScope(ownerToken, name, false);
    expect(disabled.status).toBe(200);
    expect(disabled.body.chatScopeEnabled).toBe(false);

    await archiveFunctionInvocation(ownerToken, name);
  });

  test("per-integration default-access mode: admin default-chat-scope round-trips", async () => {
    // A real org-custom definition (auth_kind none → no MCP probe, no outbound).
    const namespace = `wf4custom${Date.now()}`;
    const created = await createAdminIntegrationDefinition(ownerToken, organizationId, {
      displayName: "WF4 Custom",
      namespace,
      mcpUrl: `${stubBaseUrl}/mcp`,
      authKind: "none",
    });
    expect(created.status).toBe(200);
    // Default access mode: included in the chat default set until an exclusion is authored.
    expect(created.body.defaultChatIncluded).toBe(true);

    // Author the exclusion (§2 "default access modes"): remove it from the chat
    // default set. The composed run-scope enforcement is a gateway/worker-grant seam
    // (build_chat_default_access_scope), tier-3; the authoring surface round-trip is
    // the tier-2 seam this asserts.
    const excluded = await setAdminIntegrationDefaultChatScope(
      ownerToken,
      organizationId,
      created.body.definitionId,
      false,
    );
    expect(excluded.status).toBe(200);
    expect(excluded.body.defaultChatIncluded).toBe(false);

    const restored = await setAdminIntegrationDefaultChatScope(
      ownerToken,
      organizationId,
      created.body.definitionId,
      true,
    );
    expect(restored.status).toBe(200);
    expect(restored.body.defaultChatIncluded).toBe(true);
  });
});

// NOT COVERED here, named so the gap is loud rather than silent:
// - The COMPOSED chat default-access run scope (build_chat_default_access_scope:
//   defaults → per-integration exclusions → chat-enabled invocations → the frozen
//   allowlist a worker grant carries) is enforced at the integration gateway for a
//   real worker/session, which needs a runtime worker grant — a tier-3 concern.
//   Tier-2 asserts the authoring seams that FEED it (chat_scope_enabled per
//   invocation, default_chat_included per integration), which is where the
//   product's HTTP surface ends.
