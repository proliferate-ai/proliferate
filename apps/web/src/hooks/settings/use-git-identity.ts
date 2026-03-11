import { linkSocial } from "@/lib/auth/client";
import { orpc } from "@/lib/infra/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export function useGitIdentity() {
	const queryClient = useQueryClient();
	const searchParams = useSearchParams();
	const syncTriggered = useRef(false);

	const queryKey = orpc.profile.gitIdentity.queryOptions({ input: {} }).queryKey;

	const { data, isLoading } = useQuery(orpc.profile.gitIdentity.queryOptions({ input: {} }));

	const syncMutation = useMutation({
		...orpc.profile.syncFromGitHub.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey });
		},
	});

	const updateMutation = useMutation({
		...orpc.profile.updateGitIdentity.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey });
		},
	});

	const clearMutation = useMutation({
		...orpc.profile.clearGitIdentity.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey });
		},
	});

	// Auto-sync after GitHub OAuth callback
	const githubLinkedParam = searchParams.get("github_linked");
	useEffect(() => {
		if (githubLinkedParam === "true" && !syncTriggered.current) {
			syncTriggered.current = true;
			syncMutation.mutate({});
			// Clean URL param
			const url = new URL(window.location.href);
			url.searchParams.delete("github_linked");
			window.history.replaceState({}, "", url.toString());
		}
	}, [githubLinkedParam, syncMutation]);

	return {
		gitIdentity: data ?? null,
		isLoading,
		isSyncing: syncMutation.isPending,
		isUpdating: updateMutation.isPending,
		isClearing: clearMutation.isPending,

		linkGitHub: () => {
			linkSocial({
				provider: "github",
				scopes: ["repo", "user:email", "read:user"],
				callbackURL: "/settings/profile?github_linked=true",
			});
		},

		syncFromGitHub: () => syncMutation.mutate({}),

		updateIdentity: (gitName: string, gitEmail: string) =>
			updateMutation.mutate({ gitName, gitEmail }),

		clearIdentity: () => clearMutation.mutate({}),
	};
}
