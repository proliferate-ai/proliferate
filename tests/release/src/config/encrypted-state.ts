import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

const MAGIC = Buffer.from("PROLIFERATE_E2E_STATE_V1\0", "utf8");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function requireKeyMaterial(keyMaterial: string): string {
  const value = keyMaterial.trim();
  if (!value) {
    throw new Error("encrypted state requires non-empty key material");
  }
  return value;
}

/**
 * Seal sensitive runner state for storage in a non-secret persistence layer.
 * AES-GCM authenticates both the ciphertext and the format header; scrypt gives
 * each record a fresh, salted key even when the workflow's key material is
 * stable across runs.
 */
export function encryptState(plaintext: Buffer, keyMaterial: string): Buffer {
  const secret = requireKeyMaterial(keyMaterial);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = scryptSync(secret, salt, KEY_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, ciphertext]);
}

/** Open state produced by {@link encryptState}; tampering or a wrong key fails. */
export function decryptState(sealed: Buffer, keyMaterial: string): Buffer {
  const secret = requireKeyMaterial(keyMaterial);
  const headerBytes = MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES;
  if (sealed.length < headerBytes || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("encrypted state has an invalid or unsupported header");
  }

  let offset = MAGIC.length;
  const salt = sealed.subarray(offset, offset + SALT_BYTES);
  offset += SALT_BYTES;
  const iv = sealed.subarray(offset, offset + IV_BYTES);
  offset += IV_BYTES;
  const tag = sealed.subarray(offset, offset + TAG_BYTES);
  offset += TAG_BYTES;
  const ciphertext = sealed.subarray(offset);

  const key = scryptSync(secret, salt, KEY_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
