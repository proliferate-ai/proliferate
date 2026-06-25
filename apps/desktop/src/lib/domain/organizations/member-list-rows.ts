import type {
  OrganizationInvitationRecord,
  OrganizationMemberAuthMethodRecord,
  OrganizationMemberRecord,
} from "@/lib/domain/organizations/organization-records";

export interface MemberListRow {
  key: string;
  kind: "member" | "invitation";
  name: string;
  email: string;
  role: string;
  dateLabel: string;
  authLabel: string;
  statusFilter: "active" | "invited";
  searchText: string;
  member?: OrganizationMemberRecord;
  invitation?: OrganizationInvitationRecord;
}

export function buildMemberRows(
  members: OrganizationMemberRecord[],
  pendingInvitations: OrganizationInvitationRecord[],
): MemberListRow[] {
  return [
    ...members.map((member) => {
      const name = member.displayName || member.email;
      const authLabel = memberAuthLabel(member.authMethods);
      return {
        key: `member:${member.membershipId}`,
        kind: "member" as const,
        name,
        email: member.email,
        role: member.role,
        dateLabel: formatJoinedDate(member.joinedAt),
        authLabel,
        statusFilter: "active" as const,
        searchText: `${name} ${member.email} ${authLabel}`.toLowerCase(),
        member,
      };
    }),
    ...pendingInvitations.map((invitation) => ({
      key: `invitation:${invitation.id}`,
      kind: "invitation" as const,
      name: invitation.email,
      email: invitation.email,
      role: invitation.role,
      dateLabel: "Invited",
      authLabel: "N/A",
      statusFilter: "invited" as const,
      searchText: invitation.email.toLowerCase(),
      invitation,
    })),
  ];
}

function memberAuthLabel(methods: OrganizationMemberAuthMethodRecord[] | null | undefined): string {
  if (!methods?.length) {
    return "Unknown";
  }
  const labels = methods.map(authMethodLabel).filter(Boolean);
  return [...new Set(labels)].join(", ") || "Unknown";
}

function authMethodLabel(method: OrganizationMemberAuthMethodRecord): string {
  const label = method.label.trim();
  if (method.provider === "sso" && label.toLowerCase() === "sso" && method.brandLabel) {
    return method.brandLabel;
  }
  return label || method.brandLabel?.trim() || authProviderFallbackLabel(method.provider);
}

function authProviderFallbackLabel(provider: string): string {
  if (provider === "github") return "GitHub";
  if (provider === "google") return "Google";
  if (provider === "apple") return "Apple";
  if (provider === "sso") return "SSO";
  return provider.toUpperCase();
}

function formatJoinedDate(value: string | null | undefined): string {
  if (!value) {
    return "Joined";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Joined";
  }
  return date.toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}
