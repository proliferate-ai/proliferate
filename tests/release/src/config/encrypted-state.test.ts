import assert from "node:assert/strict";
import test from "node:test";

import { decryptState, encryptState } from "./encrypted-state.js";

const PLAINTEXT = Buffer.from(
  JSON.stringify({ refreshToken: "sensitive-refresh-token", rotatedAt: "2026-07-11T00:00:00Z" }),
);

test("encrypted state round-trips without embedding the plaintext", () => {
  const sealed = encryptState(PLAINTEXT, "stable-workflow-secret");
  assert.equal(sealed.includes(Buffer.from("sensitive-refresh-token")), false);
  assert.deepEqual(decryptState(sealed, "stable-workflow-secret"), PLAINTEXT);
});

test("encrypted state rejects a wrong key and ciphertext tampering", () => {
  const sealed = encryptState(PLAINTEXT, "correct-secret");
  assert.throws(() => decryptState(sealed, "wrong-secret"));

  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptState(tampered, "correct-secret"));
});

test("encrypted state fails closed on empty keys and malformed payloads", () => {
  assert.throws(() => encryptState(PLAINTEXT, "  "), /non-empty key material/);
  assert.throws(
    () => decryptState(Buffer.from("not-a-state-file"), "key"),
    /invalid or unsupported header/,
  );
});
