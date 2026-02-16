"use client";

import { AutomationCard } from "@/components/automations/automation-card";
import { type Recipe, RecipeCards } from "@/components/automations/recipe-cards";
import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useAutomations, useCreateAutomation } from "@/hooks/use-automations";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";

export default function AutomationsPage() {
	const router = useRouter();
	const { data: automations = [], isLoading } = useAutomations();
	const createAutomation = useCreateAutomation();

	const handleCreate = async () => {
		try {
			const automation = await createAutomation.mutateAsync({});
			router.push(`/dashboard/automations/${automation.id}`);
		} catch {
			// mutation handles error state
		}
	};

	const handleRecipeSelect = async (recipe: Recipe) => {
		try {
			const automation = await createAutomation.mutateAsync({
				name: recipe.name,
				agentInstructions: recipe.agentInstructions,
			});
			router.push(`/dashboard/automations/${automation.id}`);
		} catch {
			// mutation handles error state
		}
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto">
			<div className="max-w-4xl mx-auto px-6 py-8">
				<div className="flex items-center justify-between mb-6">
					<h1 className="text-xl font-semibold">Automations</h1>
					<Button onClick={handleCreate} disabled={createAutomation.isPending} size="sm">
						<Plus className="h-4 w-4 mr-1.5" />
						New Automation
					</Button>
				</div>

				{automations.length === 0 ? (
					<div className="flex flex-col items-center py-12">
						<h2 className="text-lg font-medium text-foreground mb-2">
							Get started with a template
						</h2>
						<p className="text-sm text-muted-foreground mb-6">
							Pick a recipe to create your first automation, or start from scratch.
						</p>
						<div className="w-full max-w-xl">
							<RecipeCards onSelect={handleRecipeSelect} disabled={createAutomation.isPending} />
						</div>
					</div>
				) : (
					<div className="grid gap-3">
						{automations.map((automation) => (
							<AutomationCard
								key={automation.id}
								id={automation.id}
								name={automation.name}
								enabled={automation.enabled}
								updatedAt={automation.updated_at}
								triggerCount={automation._count.triggers}
								scheduleCount={automation._count.schedules}
								activeProviders={automation.activeProviders}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
