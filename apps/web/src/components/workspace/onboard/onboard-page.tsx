"use client";

import { Button } from "@/components/ui/button";
import { useRepos } from "@/hooks/org/use-repos";
import { useSecrets } from "@/hooks/org/use-secrets";
import { useCreateSecret } from "@/hooks/org/use-secrets";
import { useCreateBaseline } from "@/hooks/sessions/use-baselines";
import { useCreateConfiguration } from "@/hooks/sessions/use-configurations";
import { useCreateSession } from "@/hooks/sessions/use-sessions";
import { useDashboardStore } from "@/stores/dashboard";
import { getSetupInitialPrompt } from "@proliferate/shared/prompts";
import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { RepoPicker } from "./repo-picker";
import { SecretsEditor } from "./secrets-editor";

export function OnboardPage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const preSelectedRepoId = searchParams.get("repo") ?? null;

	const { data: repos } = useRepos();
	const { data: secrets } = useSecrets();
	const { selectedModel } = useDashboardStore();

	const [selectedRepoId, setSelectedRepoId] = useState<string | null>(preSelectedRepoId);
	const [newSecrets, setNewSecrets] = useState<Array<{ key: string; value: string }>>([]);
	const [isStarting, setIsStarting] = useState(false);

	const createBaseline = useCreateBaseline();
	const createConfiguration = useCreateConfiguration();
	const createSession = useCreateSession();
	const createSecret = useCreateSecret();

	// Secrets that already exist for the selected repo
	const existingSecrets = (secrets ?? []).filter((s) => !s.repo_id || s.repo_id === selectedRepoId);

	const handleStartSetup = async () => {
		if (!selectedRepoId) {
			toast.error("Please select a repository");
			return;
		}

		setIsStarting(true);
		try {
			// Persist any new secrets the user entered
			for (const secret of newSecrets) {
				if (secret.key && secret.value) {
					await createSecret.mutateAsync({
						key: secret.key,
						value: secret.value,
						repoId: selectedRepoId,
					});
				}
			}

			await createBaseline.mutateAsync({ repoId: selectedRepoId });

			const configResult = await createConfiguration.mutateAsync({
				repoIds: [selectedRepoId],
			});

			const sessionResult = await createSession.mutateAsync({
				configurationId: configResult.configurationId,
				sessionType: "setup",
				modelId: selectedModel,
				initialPrompt: getSetupInitialPrompt(),
			});

			router.push(`/session/${sessionResult.sessionId}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to start setup");
			setIsStarting(false);
		}
	};

	return (
		<div className="flex h-full">
			{/* Left panel — description */}
			<div className="hidden lg:flex flex-col justify-center w-[45%] bg-card border-r border-border px-12 py-16">
				<div className="max-w-md">
					<h1 className="text-2xl font-semibold tracking-tight mb-3">Set Up Environment</h1>
					<p className="text-sm text-muted-foreground leading-relaxed mb-6">
						Configure your repository so agents have a working development environment. The setup
						agent will install dependencies, start services, and verify everything works — then save
						a snapshot for future sessions.
					</p>
					<div className="space-y-4 text-sm text-muted-foreground">
						<div className="flex items-start gap-3">
							<span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground shrink-0">
								1
							</span>
							<p>Select a repository and optionally add secrets your project needs.</p>
						</div>
						<div className="flex items-start gap-3">
							<span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground shrink-0">
								2
							</span>
							<p>The agent installs dependencies, starts services, and runs verification checks.</p>
						</div>
						<div className="flex items-start gap-3">
							<span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground shrink-0">
								3
							</span>
							<p>Save a snapshot — every future session starts from this exact state.</p>
						</div>
					</div>
				</div>
			</div>

			{/* Right panel — form */}
			<div className="flex-1 flex flex-col overflow-y-auto">
				<div className="flex-1 px-8 py-10 max-w-xl mx-auto w-full">
					<h2 className="text-lg font-semibold mb-1 lg:hidden">Set Up Environment</h2>
					<p className="text-sm text-muted-foreground mb-6 lg:hidden">
						Configure your repository for agent development.
					</p>

					<div className="space-y-8">
						{/* Repo picker */}
						<RepoPicker
							repos={repos ?? []}
							selectedRepoId={selectedRepoId}
							onSelect={setSelectedRepoId}
						/>

						{/* Secrets editor */}
						<SecretsEditor
							secrets={newSecrets}
							onChange={setNewSecrets}
							existingCount={existingSecrets.length}
						/>
					</div>
				</div>

				{/* CTA */}
				<div className="sticky bottom-0 border-t border-border bg-background px-8 py-4">
					<div className="max-w-xl mx-auto flex justify-end">
						<Button
							onClick={handleStartSetup}
							disabled={!selectedRepoId || isStarting}
							className="gap-2"
						>
							{isStarting ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<>
									Start Setup
									<ArrowRight className="h-4 w-4" />
								</>
							)}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
