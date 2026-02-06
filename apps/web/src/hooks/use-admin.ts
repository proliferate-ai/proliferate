"use client";

import { orpc } from "@/lib/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useAdmin() {
	const queryClient = useQueryClient();

	const { data: status, isLoading: isLoadingStatus } = useQuery({
		...orpc.admin.getStatus.queryOptions({ input: {} }),
	});

	const impersonateMutation = useMutation({
		...orpc.admin.impersonate.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.admin.getStatus.key() });
			// Refresh the page to get new session context
			window.location.reload();
		},
	});

	const stopImpersonateMutation = useMutation({
		...orpc.admin.stopImpersonate.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.admin.getStatus.key() });
			// Refresh the page to restore original session
			window.location.reload();
		},
	});

	const switchOrgMutation = useMutation({
		...orpc.admin.switchOrg.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.admin.getStatus.key() });
			// Refresh the page to get new org context
			window.location.reload();
		},
	});

	return {
		isSuperAdmin: status?.isSuperAdmin ?? false,
		impersonating: status?.impersonating ?? null,
		isLoading: isLoadingStatus,
		impersonate: impersonateMutation.mutate,
		isImpersonating: impersonateMutation.isPending,
		stopImpersonating: stopImpersonateMutation.mutate,
		isStoppingImpersonation: stopImpersonateMutation.isPending,
		switchImpersonatedOrg: switchOrgMutation.mutate,
		isSwitchingOrg: switchOrgMutation.isPending,
	};
}

export function useAdminUsers() {
	return useQuery({
		...orpc.admin.listUsers.queryOptions({ input: {} }),
		select: (data) => data.users,
	});
}

export function useAdminOrganizations() {
	return useQuery({
		...orpc.admin.listOrganizations.queryOptions({ input: {} }),
		select: (data) => data.organizations,
	});
}
