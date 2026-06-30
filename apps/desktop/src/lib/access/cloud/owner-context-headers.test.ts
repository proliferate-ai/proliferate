// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { applySelectedOrganizationHeaders } from "@/lib/access/cloud/owner-context-headers";
import { useOrganizationStore } from "@/stores/organizations/organization-store";

describe("owner context headers", () => {
  afterEach(() => {
    useOrganizationStore.getState().clearActiveOrganizationId();
  });

  it("mirrors a validated selected organization into Desktop Cloud request headers", () => {
    useOrganizationStore.getState().setActiveOrganizationId("org_123", { validated: true });

    const headers = new Headers();
    applySelectedOrganizationHeaders(headers);

    expect(headers.get("X-Proliferate-Owner-Scope")).toBe("organization");
    expect(headers.get("X-Proliferate-Org-Id")).toBe("org_123");
  });

  it("does not send an unvalidated hydrated organization selection", () => {
    useOrganizationStore.getState().setActiveOrganizationId("org_123");

    const headers = new Headers();
    applySelectedOrganizationHeaders(headers);

    expect(headers.has("X-Proliferate-Owner-Scope")).toBe(false);
    expect(headers.has("X-Proliferate-Org-Id")).toBe(false);
  });

  it("leaves personal owner context implicit when no organization is selected", () => {
    const headers = new Headers();
    applySelectedOrganizationHeaders(headers);

    expect(headers.has("X-Proliferate-Owner-Scope")).toBe(false);
    expect(headers.has("X-Proliferate-Org-Id")).toBe(false);
  });
});
