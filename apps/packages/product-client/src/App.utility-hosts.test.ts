import { describe, expect, it } from "vitest"

import { shouldLoadProductUtilityHosts } from "#product/App"

describe("product utility host loading", () => {
  it("defers the utility tree for anonymous and loading Web login", () => {
    expect(
      shouldLoadProductUtilityHosts({
        hasDesktop: false,
        authStatus: "anonymous",
        pathname: "/login",
      }),
    ).toBe(false)
    expect(
      shouldLoadProductUtilityHosts({
        hasDesktop: false,
        authStatus: "loading",
        pathname: "/login",
      }),
    ).toBe(false)
  })

  it("preserves Desktop, authenticated Web, and auth-optional product routes", () => {
    expect(
      shouldLoadProductUtilityHosts({
        hasDesktop: true,
        authStatus: "anonymous",
        pathname: "/login",
      }),
    ).toBe(true)
    expect(
      shouldLoadProductUtilityHosts({
        hasDesktop: false,
        authStatus: "authenticated",
        pathname: "/login",
      }),
    ).toBe(true)
    expect(
      shouldLoadProductUtilityHosts({
        hasDesktop: false,
        authStatus: "anonymous",
        pathname: "/",
      }),
    ).toBe(true)
  })
})
