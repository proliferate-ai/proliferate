import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deployWorkflow = readFileSync(
  new URL("../../.github/workflows/_deploy-server.yml", import.meta.url),
  "utf8",
);
const terraform = readFileSync(
  new URL("../../server/infra/main.tf", import.meta.url),
  "utf8",
);

test("hosted server deploys keep numeric Pro billing enabled", () => {
  assert.match(
    deployWorkflow,
    /\{"name":"PRO_BILLING_ENABLED","value":"true"\}/,
    "every deployed ECS revision must opt into Pro billing",
  );
  assert.match(
    terraform,
    /\{ name = "PRO_BILLING_ENABLED", value = "true" \}/,
    "the Terraform bootstrap task definition must opt into Pro billing",
  );
});
