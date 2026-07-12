#!/usr/bin/env tsx

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { decryptState, encryptState } from "../src/config/encrypted-state.js";
import { parseStagingSessionState } from "../src/fixtures/staging-session.js";

type Command = "encrypt" | "decrypt";

async function atomicWrite(filePath: string, content: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, filePath);
}

function validatePlaintext(content: Buffer): void {
  const state = parseStagingSessionState(content.toString("utf8"));
  if (!state) {
    throw new Error("staging session state has no usable refreshToken");
  }
}

async function main(): Promise<void> {
  const [command, source, destination] = process.argv.slice(2) as [Command?, string?, string?];
  if ((command !== "encrypt" && command !== "decrypt") || !source || !destination) {
    throw new Error("usage: staging-session-cache.ts <encrypt|decrypt> <source> <destination>");
  }
  const key = process.env.STATE_CACHE_KEY?.trim();
  if (!key) {
    throw new Error("STATE_CACHE_KEY is required");
  }

  const input = await readFile(source);
  if (command === "encrypt") {
    validatePlaintext(input);
    await atomicWrite(destination, encryptState(input, key));
  } else {
    const plaintext = decryptState(input, key);
    validatePlaintext(plaintext);
    await atomicWrite(destination, plaintext);
  }
}

await main();
