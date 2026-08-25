/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { buildMemberRows } from "#product/lib/domain/organizations/member-list-rows";
import type { OrganizationMemberRecord } from "#product/lib/domain/organizations/organization-records";

describe("buildMemberRows", () => {
  it("uses member auth methods instead of defaulting to GitHub", () => {
    const rows = buildMemberRows(
      [
        member({
          email: "password@example.com",
          authMethods: [
            {
              provider: "password",
              label: "Email/password",
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
              provider: "google",
              label: "Google",
            },
          ],
        }),
      ],
      [],
    );

    expect(rows[0]?.authLabel).toBe("Email/password");
    expect(rows[0]?.searchText).toContain("email/password");
    expect(rows[1]?.authLabel).toBe("GitHub, Google");
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
