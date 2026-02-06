"use client";

import { orpc } from "@/lib/orpc";
import { useQuery } from "@tanstack/react-query";

/**
 * Hook to list organizations the current user belongs to
 */
export function useOrgs() {
	return useQuery({
		...orpc.orgs.list.queryOptions({ input: {} }),
		select: (data) => data.orgs,
	});
}

/**
 * Hook to get a single organization by ID
 */
export function useOrg(id: string) {
	return useQuery({
		...orpc.orgs.get.queryOptions({ input: { id } }),
		enabled: !!id,
	});
}

/**
 * Hook to get organization members
 */
export function useOrgMembers(orgId: string) {
	return useQuery({
		...orpc.orgs.listMembers.queryOptions({ input: { id: orgId } }),
		enabled: !!orgId,
	});
}

/**
 * Hook to get pending invitations for an organization
 */
export function useOrgInvitations(orgId: string) {
	return useQuery({
		...orpc.orgs.listInvitations.queryOptions({ input: { id: orgId } }),
		enabled: !!orgId,
	});
}

/**
 * Hook to get members and invitations in one request (more efficient)
 */
export function useOrgMembersAndInvitations(orgId: string | undefined) {
	return useQuery({
		...orpc.orgs.getMembersAndInvitations.queryOptions({ input: { id: orgId! } }),
		enabled: !!orgId,
	});
}

/**
 * Hook to get domain suggestions for auto-join
 */
export function useOrgDomainSuggestions() {
	return useQuery({
		...orpc.orgs.getDomainSuggestions.queryOptions({ input: {} }),
	});
}
