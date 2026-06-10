import { describe, expect, it } from "vitest"
import {
  AuthRequestError,
  isDefinitiveAuthRejection,
} from "./proliferate-auth-transport"

describe("isDefinitiveAuthRejection", () => {
  it("treats 401 and 403 auth errors as definitive", () => {
    expect(isDefinitiveAuthRejection(new AuthRequestError("unauthorized", 401))).toBe(true)
    expect(isDefinitiveAuthRejection(new AuthRequestError("forbidden", 403))).toBe(true)
  })

  it("treats transport-normalized network failures as transient", () => {
    expect(isDefinitiveAuthRejection(new AuthRequestError("cloud unreachable", 503))).toBe(false)
    expect(isDefinitiveAuthRejection(new AuthRequestError("timeout", 408))).toBe(false)
    expect(isDefinitiveAuthRejection(new AuthRequestError("server error", 500))).toBe(false)
  })

  it("treats non-auth errors as transient", () => {
    expect(isDefinitiveAuthRejection(new TypeError("fetch failed"))).toBe(false)
    expect(isDefinitiveAuthRejection(new DOMException("Aborted", "AbortError"))).toBe(false)
    expect(isDefinitiveAuthRejection(null)).toBe(false)
    expect(isDefinitiveAuthRejection(undefined)).toBe(false)
  })
})
