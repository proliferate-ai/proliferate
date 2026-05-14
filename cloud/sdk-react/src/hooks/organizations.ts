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
} from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export function useOrganizations(enabled = true) {
  const client = useCloudClient();
  return useQuery<OrganizationListResponse>({
    queryKey: organizationsListKey(),
    queryFn: () => listOrganizations(client),
    enabled,
  });
}

export function useOrganizationMembers(organizationId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<OrganizationMembersResponse>({
    queryKey: organizationMembersKey(organizationId),
    queryFn: () => listOrganizationMembers(organizationId!, client),
    enabled: enabled && organizationId !== null,
  });
}

export function useOrganizationInvitations(organizationId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<OrganizationInvitationsResponse>({
    queryKey: organizationInvitationsKey(organizationId),
    queryFn: () => listOrganizationInvitations(organizationId!, client),
    enabled: enabled && organizationId !== null,
  });
}
