import { useQuery } from "@tanstack/react-query";
import {
  listOrganizationInvitations,
  listOrganizationMembers,
  listOrganizations,
  type OrganizationInvitationsResponse,
  type OrganizationListResponse,
  type OrganizationMembersResponse,
} from "@proliferate/cloud-sdk";
import {
  organizationInvitationsKey,
  organizationMembersKey,
  organizationsListKey,
} from "../lib/query-keys";

export function useOrganizations(enabled = true) {
  return useQuery<OrganizationListResponse>({
    queryKey: organizationsListKey(),
    queryFn: listOrganizations,
    enabled,
  });
}

export function useOrganizationMembers(organizationId: string | null, enabled = true) {
  return useQuery<OrganizationMembersResponse>({
    queryKey: organizationMembersKey(organizationId),
    queryFn: () => listOrganizationMembers(organizationId!),
    enabled: enabled && organizationId !== null,
  });
}

export function useOrganizationInvitations(organizationId: string | null, enabled = true) {
  return useQuery<OrganizationInvitationsResponse>({
    queryKey: organizationInvitationsKey(organizationId),
    queryFn: () => listOrganizationInvitations(organizationId!),
    enabled: enabled && organizationId !== null,
  });
}

