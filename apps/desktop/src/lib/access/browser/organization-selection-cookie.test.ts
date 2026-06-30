// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  clearSelectedOrganizationCookie,
  readSelectedOrganizationCookie,
  writeSelectedOrganizationCookie,
} from "@/lib/access/browser/organization-selection-cookie";

describe("organization selection cookie", () => {
  afterEach(() => {
    clearSelectedOrganizationCookie();
  });

  it("persists and reads the selected organization id", () => {
    writeSelectedOrganizationCookie("org_123");

    expect(readSelectedOrganizationCookie()).toBe("org_123");
  });

  it("preserves raw equals signs in cookie values", () => {
    document.cookie = "proliferate_org_id=org=123; path=/";

    expect(readSelectedOrganizationCookie()).toBe("org=123");
  });

  it("clears the selected organization id", () => {
    writeSelectedOrganizationCookie("org_123");
    clearSelectedOrganizationCookie();

    expect(readSelectedOrganizationCookie()).toBeNull();
  });

  it("ignores malformed cookie values", () => {
    document.cookie = "proliferate_org_id=%E0%A4%A; path=/";

    expect(readSelectedOrganizationCookie()).toBeNull();
  });
});
