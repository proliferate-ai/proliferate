import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { TEST_QUALIFICATION_TLS } from "./qualification-tls.test-fixture.js";
import { decodeQualificationTls, materializeQualificationTls } from "./qualification-tls.js";

test("qualification TLS validates wildcard coverage and materializes only mode-0600 files", async () => {
  const decoded = decodeQualificationTls(TEST_QUALIFICATION_TLS);
  assert.match(decoded.certificatePem, /BEGIN CERTIFICATE/);
  assert.match(decoded.privateKeyPem, /BEGIN PRIVATE KEY/);

  const dir = await mkdtemp(path.join(os.tmpdir(), "qualification-tls-"));
  try {
    const files = await materializeQualificationTls(TEST_QUALIFICATION_TLS, dir);
    assert.match(await readFile(files.certificatePath, "utf8"), /BEGIN CERTIFICATE/);
    assert.equal((await stat(files.certificatePath)).mode & 0o777, 0o600);
    assert.equal((await stat(files.privateKeyPath)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("qualification TLS rejects malformed base64 and a mismatched private key", () => {
  assert.throws(
    () => decodeQualificationTls({ ...TEST_QUALIFICATION_TLS, certificateBase64: "not-base64" }),
    /not valid base64/,
  );

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  assert.throws(
    () =>
      decodeQualificationTls({
        ...TEST_QUALIFICATION_TLS,
        privateKeyBase64: Buffer.from(privateKey).toString("base64"),
      }),
    /does not match/,
  );
});
