import { describe, expect, it } from "vitest";
import { organizationLogoImageValidationError } from "./logo-image";

describe("organizationLogoImageValidationError", () => {
  it("accepts supported image types within the size limit", () => {
    expect(organizationLogoImageValidationError({
      size: 256 * 1024,
      type: "image/png",
    })).toBeNull();
    expect(organizationLogoImageValidationError({
      size: 128 * 1024,
      type: "image/webp",
    })).toBeNull();
  });

  it("rejects unsupported image types", () => {
    expect(organizationLogoImageValidationError({
      size: 128 * 1024,
      type: "image/svg+xml",
    })).toBe("Use a PNG, JPEG, WebP, or GIF image.");
  });

  it("rejects supported images above the size limit", () => {
    expect(organizationLogoImageValidationError({
      size: 256 * 1024 + 1,
      type: "image/jpeg",
    })).toBe("Use an image 256 KB or smaller.");
  });
});
