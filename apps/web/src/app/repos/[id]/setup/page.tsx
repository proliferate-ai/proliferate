"use client";

import { CodingSession } from "@/components/coding-session";
import { SessionLoadingShell } from "@/components/coding-session/session-loading-shell";
import { Button } from "@/components/ui/button";
import { useCreatePrebuild } from "@/hooks/use-prebuilds";
import { useCreateSession, useFinalizeSetup } from "@/hooks/use-sessions";
import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function SetupPage() {
	const params = useParams();
	const router = useRouter();
	const repoId = params.id as string;

	const [sessionId, setSessionId] = useState<string | null>(null);
	const creationStartedRef = useRef(false);

	const createPrebuildMutation = useCreatePrebuild();
	const createSessionMutation = useCreateSession();
	const finalizeSetupMutation = useFinalizeSetup();

	// Create prebuild and session on mount
	useEffect(() => {
		if (!repoId || sessionId) return;
		if (creationStartedRef.current) return;

		creationStartedRef.current = true;

		const createPrebuildAndSession = async () => {
			try {
				// Step 1: Create prebuild with single repo
				const prebuildResult = await createPrebuildMutation.mutateAsync({
					repoIds: [repoId],
				});

				// Step 2: Create setup session with the prebuild
				const sessionResult = await createSessionMutation.mutateAsync({
					prebuildId: prebuildResult.prebuildId,
					sessionType: "setup",
				});

				setSessionId(sessionResult.sessionId);
			} catch {
				creationStartedRef.current = false;
			}
		};

		createPrebuildAndSession();
	}, [repoId, sessionId, createPrebuildMutation, createSessionMutation]);

	const handleFinalize = async () => {
		if (!sessionId) return;

		try {
			await finalizeSetupMutation.mutateAsync({
				repoId,
				sessionId,
			});
			router.push("/dashboard");
		} catch (error) {
			console.error("Failed to finalize setup:", error);
		}
	};

	const hasError = createPrebuildMutation.isError || createSessionMutation.isError;
	const errorMessage =
		createPrebuildMutation.error?.message ||
		createSessionMutation.error?.message ||
		"Failed to create session";

	// Show loading while creating
	if (!sessionId) {
		if (hasError) {
			return (
				<div className="flex h-screen items-center justify-center">
					<div className="text-center space-y-4">
						<p className="text-destructive">{errorMessage}</p>
						<Button
							variant="link"
							className="h-auto p-0 text-sm text-primary underline"
							onClick={() => {
								creationStartedRef.current = false;
								createPrebuildMutation.reset();
								createSessionMutation.reset();
							}}
						>
							Try again
						</Button>
					</div>
				</div>
			);
		}

		return (
			<div className="flex h-screen flex-col">
				<SessionLoadingShell mode="creating" />
			</div>
		);
	}

	return (
		<div className="flex h-screen flex-col">
			<CodingSession
				sessionId={sessionId}
				title="Set up your Environment"
				description="Configure your cloud environment — install dependencies, start services, set up databases. When you're done, save it as a snapshot. Every future session will start from this exact state."
				headerSlot={
					<div className="flex items-center gap-4">
						<Link
							href="/dashboard"
							className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
						>
							<ArrowLeft className="h-4 w-4" />
							Back
						</Link>
						<div className="flex-1" />
						<Button
							onClick={handleFinalize}
							disabled={!sessionId || finalizeSetupMutation.isPending}
							className="gap-2"
						>
							<Check className="h-4 w-4" />
							{finalizeSetupMutation.isPending ? "Saving..." : "Done - Save Prebuild"}
						</Button>
					</div>
				}
			/>
		</div>
	);
}
