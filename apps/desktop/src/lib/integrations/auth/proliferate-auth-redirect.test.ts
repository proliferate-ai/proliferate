import { describe, expect, it } from "vitest"

import { createPendingDesktopAuth } from "./proliferate-auth-redirect"

describe("desktop pending auth", () => {
  it("persists the provider and purpose that own the transaction", () => {
    const pending = createPendingDesktopAuth("google", "link")

    expect(pending.provider).toBe("google")
    expect(pending.purpose).toBe("link")
  })
})
