import { existsSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { bootStack, type BootedStack } from "../../../stack/boot.ts";

test("a failed child boot releases its profile lock", async () => {
  const profile = "t2surface-boot-failure";
  let unexpectedStack: BootedStack | undefined;
  let bootError: unknown;
  try {
    unexpectedStack = await bootStack({
      profile,
      skipFrontend: true,
      extraServerEnv: {
        CLOUD_BILLING_MODE: "enforce",
        E2B_API_KEY: "",
      },
    });
  } catch (error) {
    bootError = error;
  } finally {
    await unexpectedStack?.teardown();
  }

  expect(bootError).toBeDefined();
  const profileLock = path.join(
    process.env.HOME ?? "",
    ".proliferate-local",
    "dev",
    "profiles",
    profile,
    "run.lock",
  );
  expect(existsSync(profileLock)).toBe(false);
});
