import { describe, expect, it } from "vitest";

import { diagnosticField } from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";
import { parseProducerRecordV1 } from "@proliferate/product-client/internal/domain/diagnostics/validation";
import {
  MAX_ARGUMENT_LIST_ITEMS,
  MAX_ARGUMENT_OBJECT_FIELDS,
  MAX_ID_BYTES,
  MAX_MESSAGE_BYTES,
  MAX_NAME_BYTES,
  MAX_SAFE_INTEGER,
  MAX_STRING_BYTES,
} from "@proliferate/product-client/internal/domain/diagnostics/limits";
import {
  buildRendererProducerRecord,
  prevalidateRendererDiagnostic,
} from "./renderer-diagnostic-filter";

const envelope = {
  producerBootId: "00000000-0000-4000-8000-000000000001",
  producerSequence: 1,
  release: "proliferate-desktop@0.4.8",
  environment: "test",
  operationId: "00000000-0000-4000-8000-000000000002",
  sourceTimestamp: "2026-08-11T12:00:00.000Z",
  pathname: "/workspace/repository-123/session-456",
};

function build(input: Parameters<typeof prevalidateRendererDiagnostic>[0]) {
  const prevalidated = prevalidateRendererDiagnostic(input);
  expect(prevalidated).not.toBeNull();
  return buildRendererProducerRecord(prevalidated!, envelope);
}

describe("renderer diagnostic filtering", () => {
  it("builds an exact schema-v1.1 detailed renderer envelope", () => {
    const built = build({
      name: "renderer.test.envelope",
      severity: "info",
      kind: "milestone",
      message: "ready",
      privacy: "operational",
      correlation: {
        operationId: "operation-1",
        parentOperationId: "operation-0",
        traceId: "trace-1",
        workspaceId: "workspace-1",
      },
      fields: {
        elapsed_ms: diagnosticField(42, "operational"),
      },
    });

    expect(built).not.toBeNull();
    expect(parseProducerRecordV1(built!.record)).toEqual(built!.record);
    expect(built!.record).toMatchObject({
      schema_version: { major: 1, minor: 1 },
      producer_sequence: 1,
      producer_boot_id: envelope.producerBootId,
      component: "desktop_renderer",
      source: "renderer",
      operation_id: "operation-1",
      parent_operation_id: "operation-0",
      trace_id: "trace-1",
      workspace_id: "workspace-1",
      name: "renderer.test.envelope",
      record_class: "detailed",
      privacy: "sensitive",
      redaction: "none",
      detailed: { kind: "milestone", message: "ready" },
    });
    expect(built!.record.lifecycle).toBeUndefined();
    expect(built!.record.arguments).toContainEqual({
      name: "pathname",
      privacy: "sensitive",
      value: { type: "string", value: envelope.pathname },
    });
  });

  it("removes nested known-secret fields and redacts secret-shaped text", () => {
    const canary = "ghp_abcdefghijklmnopqrstuvwxyz123456";
    const awsSignature = "0123456789abcdef".repeat(4);
    const awsSecurityToken = "temporary+credential/value==plain-canary";
    const privateKeyBody = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj";
    const built = build({
      name: "renderer.test.secret_filter",
      severity: "error",
      privacy: "customer_content",
      message: `request failed Authorization: Bearer ${canary}`,
      fields: {
        details: diagnosticField({
          authorization: `Bearer ${canary}`,
          proxy_authorization: canary,
          cookie: canary,
          setCookie: canary,
          access_token: canary,
          refreshToken: canary,
          identityToken: canary,
          apiKey: canary,
          client_secret: canary,
          password: canary,
          passphrase: canary,
          private_key: canary,
          env: { SAFE: "visible", API_TOKEN: canary },
          keychain: canary,
          credential: canary,
          retained: `TOKEN=${canary} url=https://example.test/path?signature=${canary}`,
          signed_url: `https://example.test/object?X-Amz-Signature=${awsSignature}`,
          temporary_signed_url: `https://example.test/object?X-Amz-Security-Token=${awsSecurityToken}`,
          basic_url: `https://user:${canary}@example.test/private`,
          pem: `-----BEGIN PRIVATE KEY-----\n${privateKeyBody}\n-----END PRIVATE KEY-----`,
        }, "customer_content"),
        runtime_secret: { privacy: "secret", value: canary } as never,
      },
    });

    const serialized = JSON.stringify(built!.record);
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain(awsSignature);
    expect(serialized).not.toContain(awsSecurityToken);
    expect(serialized).not.toContain(privateKeyBody);
    expect(serialized).toContain("[REDACTED]");
    expect(built!.record.redaction).toBe("structural");
  });

  it("removes top-level authorization-header spelling variants", () => {
    const authorizationCanary = "plain authorization credential canary";
    const proxyCanary = "plain proxy credential canary";
    const built = build({
      name: "renderer.test.authorization_headers",
      severity: "error",
      privacy: "sensitive",
      fields: {
        authorization_header: diagnosticField(authorizationCanary, "sensitive"),
        proxy_authorization_header: diagnosticField(proxyCanary, "sensitive"),
        retained: diagnosticField("ordinary detail", "sensitive"),
      },
    });
    const serialized = JSON.stringify(built!.record);

    expect(serialized).not.toContain(authorizationCanary);
    expect(serialized).not.toContain(proxyCanary);
    expect(serialized).toContain("ordinary detail");
    expect(built!.record.redaction).toBe("structural");
  });

  it("removes a top-level AWS temporary credential query key", () => {
    const canary = "temporary+credential/value==top-level-canary";
    const built = build({
      name: "renderer.test.aws_temporary_credential",
      severity: "error",
      privacy: "sensitive",
      fields: {
        x_amz_security_token: diagnosticField(canary, "sensitive"),
        retained: diagnosticField("ordinary detail", "sensitive"),
      },
    });
    const serialized = JSON.stringify(built!.record);

    expect(serialized).not.toContain(canary);
    expect(serialized).toContain("ordinary detail");
    expect(built!.record.redaction).toBe("structural");
  });

  it("removes common credential-header spellings at every admitted level", () => {
    const topLevelCanary = "plain top-level header credential";
    const nestedCanary = "plain nested header credential";
    const built = build({
      name: "renderer.test.credential_headers",
      severity: "error",
      privacy: "sensitive",
      fields: {
        x_api_key: diagnosticField(topLevelCanary, "sensitive"),
        x_auth_token: diagnosticField(topLevelCanary, "sensitive"),
        x_access_token: diagnosticField(topLevelCanary, "sensitive"),
        session_token: diagnosticField(topLevelCanary, "sensitive"),
        security_token: diagnosticField(topLevelCanary, "sensitive"),
        details: diagnosticField({
          "x-api-key": nestedCanary,
          "x-auth-token": nestedCanary,
          x_access_token: nestedCanary,
          session_token: nestedCanary,
          security_token: nestedCanary,
          retained: "ordinary detail",
        }, "sensitive"),
      },
    });
    const serialized = JSON.stringify(built!.record);

    expect(serialized).not.toContain(topLevelCanary);
    expect(serialized).not.toContain(nestedCanary);
    expect(serialized).toContain("ordinary detail");
    expect(built!.record.redaction).toBe("structural");
  });

  it("removes prefixed credential spelling variants without hiding benign counters or keys", () => {
    const topLevelCanary = "plain prefixed credential top-level";
    const nestedCanary = "plain prefixed credential nested";
    const built = build({
      name: "renderer.test.prefixed_credentials",
      severity: "error",
      privacy: "sensitive",
      fields: {
        openai_api_key: diagnosticField(topLevelCanary, "sensitive"),
        github_token: diagnosticField(topLevelCanary, "sensitive"),
        db_password: diagnosticField(topLevelCanary, "sensitive"),
        oauth_client_secret: diagnosticField(topLevelCanary, "sensitive"),
        raw_environment: diagnosticField(topLevelCanary, "sensitive"),
        raw_environment_values: diagnosticField(topLevelCanary, "sensitive"),
        raw_environment_variables: diagnosticField(topLevelCanary, "sensitive"),
        raw_env_vars: diagnosticField(topLevelCanary, "sensitive"),
        environment_variables: diagnosticField(topLevelCanary, "sensitive"),
        env_vars: diagnosticField(topLevelCanary, "sensitive"),
        process_env: diagnosticField(topLevelCanary, "sensitive"),
        keychain_contents: diagnosticField(topLevelCanary, "sensitive"),
        keychain_content: diagnosticField(topLevelCanary, "sensitive"),
        aws_secret_access_key: diagnosticField(topLevelCanary, "sensitive"),
        secret_key: diagnosticField(topLevelCanary, "sensitive"),
        retained: diagnosticField({
          provider_api_key: nestedCanary,
          service_token: nestedCanary,
          database_password: nestedCanary,
          oauth_client_secret: nestedCanary,
          environment_map: nestedCanary,
          raw_environment_variables: nestedCanary,
          raw_env_vars: nestedCanary,
          environment_variables: nestedCanary,
          env_vars: nestedCanary,
          raw_env: nestedCanary,
          process_environment_values: nestedCanary,
          account_keychain_contents: nestedCanary,
          account_keychain_content: nestedCanary,
          aws_secret_access_key: nestedCanary,
          service_secret_key: nestedCanary,
          token_count: 17,
          max_tokens: 2048,
          environment_name: "test-environment",
          environment_id: "environment-id",
          public_key: "ssh-ed25519 public material",
          monkey: "banana",
        }, "sensitive"),
      },
    });
    const serialized = JSON.stringify(built!.record);

    expect(serialized).not.toContain(topLevelCanary);
    expect(serialized).not.toContain(nestedCanary);
    expect(serialized).toContain("token_count");
    expect(serialized).toContain("max_tokens");
    expect(serialized).toContain("public_key");
    expect(serialized).toContain("ssh-ed25519 public material");
    expect(serialized).toContain("environment_name");
    expect(serialized).toContain("test-environment");
    expect(serialized).toContain("environment_id");
    expect(serialized).toContain("MONKEY".toLowerCase());
    expect(serialized).toContain("banana");
    expect(built!.record.redaction).toBe("structural");
  });

  it("ignores non-enumerable input, field, and nested properties", () => {
    const hiddenInput = Object.defineProperty({
      severity: "info",
      privacy: "operational",
    }, "name", {
      enumerable: false,
      value: "renderer.test.hidden_input",
    });
    expect(prevalidateRendererDiagnostic(hiddenInput as never)).toBeNull();

    const hiddenCanary = "hidden-secret-canary";
    const nested = { visible: "retained" };
    Object.defineProperty(nested, "hidden", {
      enumerable: false,
      value: hiddenCanary,
    });
    const fields = {
      visible: diagnosticField(nested, "customer_content"),
    };
    Object.defineProperty(fields, "hidden_field", {
      enumerable: false,
      value: diagnosticField(hiddenCanary, "sensitive"),
    });
    const built = build({
      name: "renderer.test.enumerable_only",
      severity: "info",
      privacy: "customer_content",
      fields,
    });
    const serialized = JSON.stringify(built!.record);
    expect(serialized).toContain("retained");
    expect(serialized).not.toContain(hiddenCanary);
  });

  it("does not traverse non-enumerable field values or array indexes", () => {
    const hiddenFieldCanary = "hidden-field-value-canary";
    const hiddenArrayCanary = "hidden-array-index-canary";
    const hiddenFieldValue = Object.defineProperty({
      privacy: "sensitive",
    }, "value", {
      enumerable: false,
      value: hiddenFieldCanary,
    });
    const array = ["visible-array-value", "placeholder"];
    Object.defineProperty(array, "1", {
      configurable: true,
      enumerable: false,
      value: hiddenArrayCanary,
    });
    const built = build({
      name: "renderer.test.enumerable_container_edges",
      severity: "info",
      privacy: "sensitive",
      fields: {
        hidden_wrapper: hiddenFieldValue as never,
        array: diagnosticField(array, "sensitive"),
      },
    });
    const serialized = JSON.stringify(built!.record);

    expect(serialized).not.toContain(hiddenFieldCanary);
    expect(serialized).not.toContain(hiddenArrayCanary);
    expect(serialized).toContain("visible-array-value");
    expect(serialized).toContain("[accessor]");
    expect(built!.record.redaction).toBe("structural");
  });

  it("never executes accessors and bounds cycles, containers, strings, and record bytes", () => {
    let getterCalls = 0;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    Object.defineProperty(cyclic, "throwing", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("accessor executed");
      },
    });
    const oversizedFields = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `field_${index}`,
        diagnosticField("x".repeat(8_000), "sensitive"),
      ]),
    );
    const built = build({
      name: "renderer.test.bounds",
      severity: "warn",
      privacy: "operational",
      message: "m".repeat(32_000),
      fields: {
        cycle: diagnosticField(cyclic, "sensitive"),
        list: diagnosticField(Array.from({ length: 40 }, (_, index) => index), "operational"),
        ...oversizedFields,
      },
    });

    expect(getterCalls).toBe(0);
    expect(built).not.toBeNull();
    expect(built!.serializedBytes).toBeLessThanOrEqual(65_536);
    expect(built!.record.arguments.length).toBeLessThanOrEqual(32);
    expect(JSON.stringify(built!.record)).toContain("[circular]");
    expect(built!.record.redaction).toBe("structural");
  });

  it("preserves permitted local detail and identifier-bearing pathnames", () => {
    const detail = {
      prompt: "please inspect the failure",
      content: "local transcript detail",
      message: "arbitrary useful error prose",
      path: "/Users/person/repository/file.ts",
      file_path: "/tmp/build/output.log",
      repository: "private-repository-name",
      stdout: "compiler output",
      stderr: "compiler error",
      response: "provider response detail",
      tool_arguments: "--flag value",
      tool_results: "result",
      provider_response: "ordinary provider detail",
      url: "https://example.test/path?mode=diagnostic",
      ordinary_assignment: "MONKEY=banana",
    };
    const built = build({
      name: "renderer.test.local_detail",
      severity: "debug",
      privacy: "customer_content",
      fields: { detail: diagnosticField(detail, "customer_content") },
    });
    const serialized = JSON.stringify(built!.record);

    for (const value of Object.values(detail)) {
      expect(serialized).toContain(value);
    }
    expect(serialized).toContain(envelope.pathname);
  });

  it("rejects invalid semantic names and correlation ids before construction", () => {
    expect(prevalidateRendererDiagnostic({
      name: "Renderer Invalid",
      severity: "info",
      privacy: "operational",
    })).toBeNull();
    expect(prevalidateRendererDiagnostic({
      name: "renderer.test.invalid_id",
      severity: "info",
      privacy: "operational",
      correlation: { operationId: "x".repeat(129) },
    })).toBeNull();
  });

  it("pins exact name, identifier, message, and string byte boundaries", () => {
    const exactName = `r${"n".repeat(MAX_NAME_BYTES - 1)}`;
    const exactId = "i".repeat(MAX_ID_BYTES);
    const exactMessage = "é".repeat(MAX_MESSAGE_BYTES / 2);
    const exactString = "é".repeat(MAX_STRING_BYTES / 2);
    const exact = build({
      name: exactName,
      severity: "info",
      privacy: "operational",
      message: exactMessage,
      correlation: { operationId: exactId },
      fields: { exact_string: diagnosticField(exactString, "operational") },
    });

    expect(exact!.record.name).toBe(exactName);
    expect(exact!.record.operation_id).toBe(exactId);
    expect(exact!.record.detailed?.message).toBe(exactMessage);
    expect(JSON.stringify(exact!.record)).toContain(exactString);
    expect(prevalidateRendererDiagnostic({
      name: `${exactName}n`,
      severity: "info",
      privacy: "operational",
    })).toBeNull();
    expect(prevalidateRendererDiagnostic({
      name: "renderer.test.id_over",
      severity: "info",
      privacy: "operational",
      correlation: { operationId: `${exactId}i` },
    })).toBeNull();

    const over = build({
      name: "renderer.test.multibyte_over",
      severity: "info",
      privacy: "operational",
      message: `${exactMessage}é`,
      fields: { over_string: diagnosticField(`${exactString}é`, "operational") },
    });
    expect(new TextEncoder().encode(over!.record.detailed?.message).byteLength)
      .toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    expect(JSON.stringify(over!.record)).toContain("[truncated]");
    expect(over!.record.redaction).toBe("structural");
  });

  it("pins exact list, object, and depth bounds", () => {
    const exactList = Array.from({ length: MAX_ARGUMENT_LIST_ITEMS }, (_, index) => index);
    const overList = [...exactList, MAX_ARGUMENT_LIST_ITEMS];
    const exactObject = Object.fromEntries(
      Array.from({ length: MAX_ARGUMENT_OBJECT_FIELDS }, (_, index) => [`field_${index}`, index]),
    );
    const overObject = { ...exactObject, over_field: "removed" };
    const built = build({
      name: "renderer.test.container_bounds",
      severity: "info",
      privacy: "operational",
      fields: {
        exact_list: diagnosticField(exactList, "operational"),
        over_list: diagnosticField(overList, "operational"),
        exact_object: diagnosticField(exactObject, "operational"),
        over_object: diagnosticField(overObject, "operational"),
        exact_depth: diagnosticField({ one: { two: { value: "retained-at-depth-four" } } }, "operational"),
        over_depth: diagnosticField({ one: { two: { three: { value: "removed-at-depth-five" } } } }, "operational"),
      },
    });
    const serialized = JSON.stringify(built!.record);

    expect(serialized).toContain("retained-at-depth-four");
    expect(serialized).not.toContain("removed-at-depth-five");
    expect(serialized).not.toContain("over_field");
    expect(serialized).toContain("[truncated]");
    expect(built!.record.redaction).toBe("structural");
  });

  it("normalizes non-finite, finite unsafe, and unsupported values", () => {
    const built = build({
      name: "renderer.test.unsupported_values",
      severity: "info",
      privacy: "operational",
      fields: {
        nan: diagnosticField(Number.NaN, "operational"),
        infinity: diagnosticField(Number.POSITIVE_INFINITY, "operational"),
        unsafe_integer: diagnosticField(MAX_SAFE_INTEGER + 2, "operational"),
        callable: diagnosticField(() => undefined, "operational"),
        symbol: diagnosticField(Symbol("unsupported"), "operational"),
        date: diagnosticField(new Date("2026-08-11T00:00:00.000Z"), "operational"),
      },
    });
    const serialized = JSON.stringify(built!.record);

    expect(serialized).toContain("[number:NaN]");
    expect(serialized).toContain("[number:Infinity]");
    expect(built!.record.arguments).toContainEqual({
      name: "unsafe_integer",
      privacy: "operational",
      value: { type: "float", value: MAX_SAFE_INTEGER + 2 },
    });
    expect(serialized).toContain("[function]");
    expect(serialized).toContain("[symbol]");
    expect(serialized).toContain("[object]");
    expect(built!.record.redaction).toBe("structural");
  });

  it("bounds global traversal work for a repeatedly shared diagnostic DAG", () => {
    let leafVisits = 0;
    const leafTarget = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [`value_${index}`, "x".repeat(512)]),
    );
    const sharedLeaf = new Proxy(leafTarget, {
      ownKeys(target) {
        leafVisits += 1;
        return Reflect.ownKeys(target);
      },
    });
    const sharedBranch = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [`leaf_${index}`, sharedLeaf]),
    );
    const sharedRoot = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [`branch_${index}`, sharedBranch]),
    );

    const built = build({
      name: "renderer.test.shared_dag_budget",
      severity: "info",
      privacy: "sensitive",
      fields: { dag: diagnosticField(sharedRoot, "sensitive") },
    });

    expect(leafVisits).toBeLessThan(500);
    expect(built!.serializedBytes).toBeLessThanOrEqual(65_536);
    expect(built!.record.redaction).toBe("structural");
  });

  it("bounds large text work and redacts secrets that cross the retained prefix", () => {
    const bearerCanary = "plainBearerCredentialCanary0123456789";
    const pemCanary = "plain-private-key-body-canary";
    const built = build({
      name: "renderer.test.large_text_budget",
      severity: "error",
      privacy: "sensitive",
      message: `${"m".repeat(MAX_MESSAGE_BYTES - 32)} Bearer ${bearerCanary}${"z".repeat(1_000_000)}`,
      fields: {
        pem: diagnosticField(
          `${"p".repeat(MAX_STRING_BYTES - 80)}-----BEGIN PRIVATE KEY-----\n${pemCanary}${"q".repeat(1_000_000)}`,
          "sensitive",
        ),
      },
    });
    const serialized = JSON.stringify(built!.record);

    expect(serialized).not.toContain(bearerCanary);
    expect(serialized).not.toContain(pemCanary);
    expect(serialized).toContain("[REDACTED]");
    expect(built!.serializedBytes).toBeLessThanOrEqual(65_536);
    expect(built!.record.redaction).toBe("structural");
  });

  it("redacts credentials whose terminators fall beyond the text work boundary", () => {
    const passwordCanary = "userinfo-password-canary";
    const tokenBoundaryPrefix = "ghp_AB12CD";
    const built = build({
      name: "renderer.test.trailing_secret_boundary",
      severity: "error",
      privacy: "sensitive",
      fields: {
        userinfo: diagnosticField(
          `${"u".repeat(MAX_STRING_BYTES - 40)} https://user:${passwordCanary}${"p".repeat(600)}@host.invalid`,
          "sensitive",
        ),
        token: diagnosticField(
          `${"t".repeat(MAX_STRING_BYTES + 512 - tokenBoundaryPrefix.length)}${tokenBoundaryPrefix}${"z".repeat(600)}`,
          "sensitive",
        ),
      },
    });
    const serialized = JSON.stringify(built!.record);

    expect(serialized).not.toContain(passwordCanary);
    expect(serialized).not.toContain(tokenBoundaryPrefix);
    expect(serialized).toContain("[REDACTED]");
    expect(built!.record.redaction).toBe("structural");
  });
});
