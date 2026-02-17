"use client";

import { orpc } from "@/lib/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Fetch the automation template catalog.
 */
export function useTemplateCatalog() {
	return useQuery({
		...orpc.templates.list.queryOptions({ input: undefined }),
		select: (data) => data.templates,
		staleTime: 5 * 60 * 1000, // Templates rarely change
	});
}

/**
 * Create an automation from a template.
 */
export function useCreateFromTemplate() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.automations.createFromTemplate.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.automations.list.key() });
		},
	});

	const mutateAsync = async (input: {
		templateId: string;
		integrationBindings: Record<string, string>;
	}) => {
		const result = await mutation.mutateAsync(input);
		return result.automation;
	};

	return {
		...mutation,
		mutateAsync,
	};
}
