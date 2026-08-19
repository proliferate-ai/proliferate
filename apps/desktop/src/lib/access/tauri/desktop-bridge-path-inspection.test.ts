import { describe, expect, it, vi } from "vitest";

const inspectPath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/access/tauri/shell", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/access/tauri/shell")>(),
  inspectPath,
}));

import { desktopBridge } from "@/lib/access/tauri/desktop-bridge";

describe("desktopBridge path inspection", () => {
  it.each([
    { kind: "file" },
    { kind: "directory" },
    { kind: "missing" },
    { kind: "unavailable", reason: "invalid_path" },
    { kind: "unavailable", reason: "permission_denied" },
    { kind: "unavailable", reason: "unsupported_type" },
    { kind: "unavailable", reason: "io_error" },
  ] as const)("preserves the typed payload %#", async (inspection) => {
    inspectPath.mockResolvedValue(inspection);

    await expect(desktopBridge.files.inspectPath("/repo/item")).resolves.toBe(inspection);
  });

  it("preserves the invoke rejection", async () => {
    const rejection = new Error("invoke rejected");
    inspectPath.mockRejectedValue(rejection);

    await expect(desktopBridge.files.inspectPath("/repo/item")).rejects.toBe(rejection);
  });
});
