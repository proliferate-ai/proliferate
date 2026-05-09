export type OrganizationRole = "owner" | "admin" | "member";

export interface OrganizationRecord {
  id: string;
  name: string;
  logoImage?: string | null;
  logoDomain?: string | null;
}

export interface OrganizationMemberRecord {
  membershipId: string;
  userId: string;
  role: OrganizationRole;
  status: string;
  displayName?: string | null;
  email: string;
  avatarUrl?: string | null;
}

export interface OrganizationInvitationRecord {
  id: string;
  email: string;
  role: string;
  status: string;
  deliveryStatus: string;
}

export type OrganizationBadgeTone = "neutral" | "success" | "warning" | "destructive";

interface OrganizationStatusBadge {
  label: string;
  tone: OrganizationBadgeTone;
}

const MEMBERSHIP_STATUS_BADGES: Record<string, OrganizationStatusBadge> = {
  active: { label: "Active", tone: "success" },
  removed: { label: "Removed", tone: "destructive" },
};

const INVITATION_STATUS_BADGES: Record<string, OrganizationStatusBadge> = {
  pending: { label: "Pending", tone: "warning" },
  accepted: { label: "Accepted", tone: "success" },
  revoked: { label: "Revoked", tone: "destructive" },
  expired: { label: "Expired", tone: "neutral" },
};

export function membershipStatusBadge(status: string): OrganizationStatusBadge {
  return MEMBERSHIP_STATUS_BADGES[status] ?? { label: status, tone: "neutral" };
}

export function invitationStatusBadge(status: string): OrganizationStatusBadge {
  return INVITATION_STATUS_BADGES[status] ?? { label: status, tone: "neutral" };
}
