import { describe, expect, it } from "vitest";
import { formatWorkedForDuration } from "./transcript-work-duration";

describe("formatWorkedForDuration", () => {
  it("formats completed turn time like the Codex work disclosure", () => {
    expect(formatWorkedForDuration(
      "2026-07-10T12:00:00.000Z",
      "2026-07-10T12:13:25.000Z",
    )).toBe("Worked for 13m 25s");
    expect(formatWorkedForDuration(
      "2026-07-10T12:00:00.000Z",
      "2026-07-10T13:02:00.000Z",
    )).toBe("Worked for 1h 2m");
  });

  it("handles sub-second work and rejects invalid ranges", () => {
    expect(formatWorkedForDuration(
      "2026-07-10T12:00:00.000Z",
      "2026-07-10T12:00:00.500Z",
    )).toBe("Worked for <1s");
    expect(formatWorkedForDuration("later", "earlier")).toBeNull();
  });
});
