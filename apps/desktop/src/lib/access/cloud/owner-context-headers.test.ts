// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  clearSelectedOrganizationCookie,
  writeSelectedOrganizationCookie,
} from "@/lib/access/browser/organization-selection-cookie";
import { applySelectedOrganizationHeaders } from "@/lib/access/cloud/owner-context-headers";

describe("owner context headers", () => {
  afterEach(() => {
    clearSelectedOrganizationCookie();
  });

  it("mirrors the selected organization into Desktop Cloud request headers", () => {
    writeSelectedOrganizationCookie("org_123");

    const headers = new Headers();
    applySelectedOrganizationHeaders(headers);

    expect(headers.get("X-Proliferate-Owner-Scope")).toBe("organization");
    expect(headers.get("X-Proliferate-Org-Id")).toBe("org_123");
  });

  it("leaves personal owner context implicit when no organization is selected", () => {
    const headers = new Headers();
    applySelectedOrganizationHeaders(headers);

    expect(headers.has("X-Proliferate-Owner-Scope")).toBe(false);
    expect(headers.has("X-Proliferate-Org-Id")).toBe(false);
  });
});
