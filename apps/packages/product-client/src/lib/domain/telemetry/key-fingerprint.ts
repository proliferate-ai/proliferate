const TELEMETRY_KEY_DOMAIN = "proliferate.telemetry-key.v1\u0000";
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;

export function fingerprintTelemetryKey(serializedKey: string): string {
  const bytes = new TextEncoder().encode(TELEMETRY_KEY_DOMAIN + serializedKey);
  let fingerprint = FNV_OFFSET_BASIS_64;

  for (const byte of bytes) {
    fingerprint ^= BigInt(byte);
    fingerprint = BigInt.asUintN(64, fingerprint * FNV_PRIME_64);
  }

  return `tk1_${fingerprint.toString(16).padStart(16, "0")}`;
}
