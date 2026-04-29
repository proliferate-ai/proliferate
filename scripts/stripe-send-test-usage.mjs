#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const envLocalPath = path.join(repoRoot, "server", ".env.local");

function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function runStripe(args) {
  const out = execFileSync("stripe", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

function argValue(name, fallback) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

const env = { ...readEnvFile(envLocalPath), ...process.env };
const eventName = argValue(
  "--event-name",
  env.STRIPE_SANDBOX_METER_EVENT_NAME || "proliferate_sandbox_seconds",
);
const seconds = Number(argValue("--seconds", "120"));
if (!Number.isFinite(seconds) || seconds <= 0) {
  throw new Error("--seconds must be a positive number");
}

let customerId = argValue("--customer", "");
if (!customerId) {
  const customer = runStripe([
    "customers",
    "create",
    "--email",
    `local-stripe-hit-${Date.now()}@proliferate.dev`,
    "-d",
    "metadata[environment]=local_test",
    "-d",
    "metadata[purpose]=meter_event_smoke",
  ]);
  customerId = customer.id;
}

const identifier = argValue("--identifier", `local-smoke-${Date.now()}`);
const meterEvent = runStripe([
  "billing",
  "meter_events",
  "create",
  "--event-name",
  eventName,
  "--identifier",
  identifier,
  "-d",
  `payload[stripe_customer_id]=${customerId}`,
  "-d",
  `payload[value]=${Math.ceil(seconds)}`,
]);

console.log(JSON.stringify({
  eventName,
  identifier: meterEvent.identifier,
  customerId,
  seconds: Math.ceil(seconds),
  livemode: meterEvent.livemode,
  created: meterEvent.created,
}, null, 2));
