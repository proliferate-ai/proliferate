import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const QUALIFICATION_TLS_CERTIFICATE_ENV = "RELEASE_E2E_QUALIFICATION_TLS_CERTIFICATE_B64";
export const QUALIFICATION_TLS_PRIVATE_KEY_ENV = "RELEASE_E2E_QUALIFICATION_TLS_PRIVATE_KEY_B64";
export const QUALIFICATION_TLS_PROBE_HOST = "probe.qualification.proliferate.com";

export interface QualificationTlsInput {
  certificateBase64: string;
  privateKeyBase64: string;
}

export interface QualificationTlsFiles {
  certificatePath: string;
  privateKeyPath: string;
}

/**
 * Decodes and validates the reusable public qualification certificate before a
 * world mutates AWS. The certificate must be currently valid, cover every
 * one-label qualification hostname, and match the supplied private key.
 */
export function decodeQualificationTls(input: QualificationTlsInput): {
  certificatePem: string;
  privateKeyPem: string;
} {
  const certificatePem = decodeStrictBase64(input.certificateBase64, "qualification TLS certificate");
  const privateKeyPem = decodeStrictBase64(input.privateKeyBase64, "qualification TLS private key");

  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(certificatePem);
  } catch {
    throw new Error("qualification TLS certificate is not a valid PEM-encoded X.509 certificate.");
  }

  const now = Date.now();
  if (now < Date.parse(certificate.validFrom) || now > Date.parse(certificate.validTo)) {
    throw new Error("qualification TLS certificate is not currently valid.");
  }
  if (!certificate.checkHost(QUALIFICATION_TLS_PROBE_HOST)) {
    throw new Error(
      `qualification TLS certificate does not cover ${QUALIFICATION_TLS_PROBE_HOST}; ` +
        "a wildcard for *.qualification.proliferate.com is required.",
    );
  }

  try {
    const certificateKey = certificate.publicKey.export({ type: "spki", format: "der" });
    const privateKey = createPrivateKey(privateKeyPem);
    const suppliedKey = createPublicKey(privateKey).export({ type: "spki", format: "der" });
    if (!certificateKey.equals(suppliedKey)) {
      throw new Error("mismatch");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "mismatch") {
      throw new Error("qualification TLS private key does not match the certificate.");
    }
    throw new Error("qualification TLS private key is not a valid PEM key matching the certificate.");
  }

  return { certificatePem, privateKeyPem };
}

export async function materializeQualificationTls(
  input: QualificationTlsInput,
  secretsDir: string,
): Promise<QualificationTlsFiles> {
  const decoded = decodeQualificationTls(input);
  await mkdir(secretsDir, { recursive: true, mode: 0o700 });
  const certificatePath = path.join(secretsDir, "qualification-tls-certificate.pem");
  const privateKeyPath = path.join(secretsDir, "qualification-tls-private-key.pem");
  await writeFile(certificatePath, ensureTrailingNewline(decoded.certificatePem), { mode: 0o600 });
  await writeFile(privateKeyPath, ensureTrailingNewline(decoded.privateKeyPem), { mode: 0o600 });
  return { certificatePath, privateKeyPath };
}

function decodeStrictBase64(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error(`${label} is not valid base64.`);
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.toString("base64") !== normalized) {
    throw new Error(`${label} is not canonical base64.`);
  }
  return bytes.toString("utf8");
}

function ensureTrailingNewline(value: string): string {
  return `${value.trimEnd()}\n`;
}
