/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { buildMemberRows } from "@/lib/domain/organizations/member-list-rows";
import type { OrganizationMemberRecord } from "@/lib/domain/organizations/organization-records";

describe("buildMemberRows", () => {
  it("uses member auth methods instead of defaulting to GitHub", () => {
    const rows = buildMemberRows(
      [
        member({
          email: "sso@example.com",
          authMethods: [
            {
              provider: "sso",
              label: "SSO",
              brandLabel: "Google SSO",
            },
          ],
        }),
        member({
          email: "mixed@example.com",
          authMethods: [
            {
              provider: "github",
              label: "GitHub",
            },
            {
              provider: "sso",
              label: "Okta SSO",
              brandLabel: "Okta SSO",
            },
          ],
        }),
      ],
      [],
    );

    expect(rows[0]?.authLabel).toBe("Google SSO");
    expect(rows[0]?.searchText).toContain("google sso");
    expect(rows[1]?.authLabel).toBe("GitHub, Okta SSO");
  });
});

function member(overrides: Partial<OrganizationMemberRecord> = {}): OrganizationMemberRecord {
  return {
    membershipId: overrides.membershipId ?? `membership-${overrides.email ?? "user@example.com"}`,
    userId: overrides.userId ?? `user-${overrides.email ?? "user@example.com"}`,
    role: overrides.role ?? "member",
    status: overrides.status ?? "active",
    displayName: overrides.displayName ?? null,
    email: overrides.email ?? "user@example.com",
    avatarUrl: overrides.avatarUrl ?? null,
    joinedAt: overrides.joinedAt ?? "2026-06-25T00:00:00.000Z",
    authMethods: overrides.authMethods ?? [],
  };
}
