import { describe, expect, it } from "vitest";

import { computeGrantBalance } from "./organization-limits-presentation";

describe("computeGrantBalance", () => {
  it("uses only active grants for the organization balance", () => {
    const plan = {
      grantAllocations: [
        {
          grantType: "pro_period",
          totalSeconds: 20 * 3600,
          consumedSeconds: 0,
          remainingSeconds: 20 * 3600,
          active: false,
        },
        {
          grantType: "pro_period",
          totalSeconds: 20 * 3600,
          consumedSeconds: 20 * 3600,
          remainingSeconds: 0,
          active: true,
        },
      ],
    } as Parameters<typeof computeGrantBalance>[0];

    expect(computeGrantBalance(plan)).toEqual({
      label: "Compute units",
      available: "0 PCUs",
      total: "20 PCUs purchased",
      used: "20 PCUs used",
      percentAvailable: 0,
    });
  });
});
