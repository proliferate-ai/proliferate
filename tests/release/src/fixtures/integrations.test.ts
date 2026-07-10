import assert from "node:assert/strict";
import { test } from "node:test";

import {
  API_KEY_INTEGRATION_NAMESPACES,
  DEFAULT_INTEGRATION_NAMESPACE,
  InvalidIntegrationNamespaceError,
  resolveIntegrationNamespace,
} from "./integrations.js";

test("resolveIntegrationNamespace defaults to exa when unset", () => {
  assert.equal(resolveIntegrationNamespace({}), DEFAULT_INTEGRATION_NAMESPACE);
  assert.equal(resolveIntegrationNamespace({}), "exa");
});

test("resolveIntegrationNamespace accepts every cataloged api_key namespace", () => {
  for (const namespace of API_KEY_INTEGRATION_NAMESPACES) {
    assert.equal(resolveIntegrationNamespace({ RELEASE_E2E_INTEGRATION_NAMESPACE: namespace }), namespace);
  }
});

test("resolveIntegrationNamespace rejects Slack (cataloged oauth2, not api_key)", () => {
  assert.throws(
    () => resolveIntegrationNamespace({ RELEASE_E2E_INTEGRATION_NAMESPACE: "slack" }),
    InvalidIntegrationNamespaceError,
  );
});

test("resolveIntegrationNamespace rejects an unknown namespace", () => {
  assert.throws(
    () => resolveIntegrationNamespace({ RELEASE_E2E_INTEGRATION_NAMESPACE: "not-a-real-integration" }),
    /not a cataloged api_key-kind seed integration/,
  );
});

test("resolveIntegrationNamespace treats empty/whitespace as unset", () => {
  assert.equal(resolveIntegrationNamespace({ RELEASE_E2E_INTEGRATION_NAMESPACE: "   " }), DEFAULT_INTEGRATION_NAMESPACE);
});
