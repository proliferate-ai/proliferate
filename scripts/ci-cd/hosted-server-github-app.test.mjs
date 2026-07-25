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

const runtimeSecretNames = [
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_WEBHOOK_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
];

test("hosted server deploys replace managed-cloud GitHub App configuration", () => {
  for (const name of [
    "GITHUB_APP_ID",
    "GITHUB_APP_SLUG",
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_CALLBACK_BASE_URL",
  ]) {
    assert.match(
      deployWorkflow,
      new RegExp(`\\{"name":"${name}","value":\\$github_app_`),
      `${name} must be replaced in every hosted ECS revision`,
    );
    assert.match(
      terraform,
      new RegExp(`\\{ name = "${name}", value = var\\.github_app_`),
      `${name} must be present in the Terraform bootstrap task definition`,
    );
  }

  for (const name of [
    "ID",
    "SLUG",
    "CLIENT_ID",
    "CALLBACK_BASE_URL",
    "SECRET_ARN",
  ]) {
    assert.match(
      deployWorkflow,
      new RegExp(`MANAGED_CLOUD_GITHUB_APP_${name}:\\s+\\$\\{\\{ vars\\.MANAGED_CLOUD_GITHUB_APP_${name}`),
      `the hosted workflow must read MANAGED_CLOUD_GITHUB_APP_${name} from the target environment`,
    );
  }
  assert.doesNotMatch(
    deployWorkflow,
    /vars\.GITHUB_APP_/,
    "GitHub rejects Actions variables whose names begin with the reserved GITHUB_ prefix",
  );
  assert.match(
    terraform,
    /actions\s+= \["secretsmanager:GetSecretValue"\]/,
    "the Terraform execution role must be able to load the managed-cloud GitHub App secret",
  );

  for (const name of runtimeSecretNames) {
    assert.match(
      deployWorkflow,
      new RegExp(`"name":"${name}"[\\s\\S]+?"valueFrom":\\(\\$github_app_secret_arn`),
      `${name} must be replaced from AWS Secrets Manager in every hosted ECS revision`,
    );
    assert.match(
      terraform,
      new RegExp(`name\\s+= "${name}"[\\s\\S]+?valueFrom = "\\$\\{var\\.github_app_secret_arn\\}:${name}::"`),
      `${name} must be present in the Terraform bootstrap task definition`,
    );
  }
});
