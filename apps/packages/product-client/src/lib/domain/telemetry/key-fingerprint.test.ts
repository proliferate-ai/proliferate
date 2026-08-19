import { describe, expect, it } from "vitest";
import { fingerprintTelemetryKey } from "#product/lib/domain/telemetry/key-fingerprint";

const PATH_MARKERS = [
  "src/private/credentials.txt",
  "/Users/example/private-workspace/secret.md",
  "/Users/example",
  "https://runtime.example.invalid/v1/files?token=private",
] as const;

describe("fingerprintTelemetryKey", () => {
  it.each([
    ["", "tk1_d08624c63002b21a"],
    ['["workspace","src/App.tsx"]', "tk1_48f618066ba9a482"],
    ['["workspace","目录/é🙂.md"]', "tk1_94a346b4ef2c995a"],
  ])("pins the cross-runtime vector for %j", (serializedKey, expected) => {
    expect(fingerprintTelemetryKey(serializedKey)).toBe(expected);
  });

  it("is repeatable, fixed-width, and distinguishes representative inputs", () => {
    const first = fingerprintTelemetryKey('["workspace","src/a.ts"]');
    const repeated = fingerprintTelemetryKey('["workspace","src/a.ts"]');
    const different = fingerprintTelemetryKey('["workspace","src/b.ts"]');

    expect(repeated).toBe(first);
    expect(different).not.toBe(first);
    expect(first).toMatch(/^tk1_[0-9a-f]{16}$/);
    expect(first).toHaveLength(20);
    expect(fingerprintTelemetryKey("x".repeat(4_096))).toHaveLength(20);
  });

  it("does not retain path, root, home, or runtime URL markers", () => {
    const serializedKey = JSON.stringify(["workspace-files", ...PATH_MARKERS]);
    const fingerprint = fingerprintTelemetryKey(serializedKey);

    for (const marker of PATH_MARKERS) {
      expect(fingerprint).not.toContain(marker);
    }
    expect(fingerprint).toMatch(/^tk1_[0-9a-f]{16}$/);
  });
});
