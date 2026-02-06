"use client";

import { ConnectionSelector } from "@/components/integrations/connection-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GithubIcon } from "@/components/ui/icons";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Laptop, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

type SelectionState =
	| { type: "selecting"; pendingId: string | null }
	| { type: "confirming" }
	| { type: "connected"; connectionId: string }
	| { type: "local-git" };

function DeviceGitHubContent() {
	const { data: session, isPending: sessionLoading } = useSession();
	const searchParams = useSearchParams();
	const [selectionState, setSelectionState] = useState<SelectionState>({
		type: "selecting",
		pendingId: null,
	});

	// Mutation to store the selection for CLI polling
	const selectMutation = useMutation({
		...orpc.cli.github.select.mutationOptions(),
		onSuccess: (_, variables) => {
			if (variables.connectionId === "local-git") {
				setSelectionState({ type: "local-git" });
			} else {
				setSelectionState({ type: "connected", connectionId: variables.connectionId });
			}
		},
	});

	// CLI passes orgId to ensure GitHub connection goes to the right org
	const cliOrgId = searchParams.get("orgId");

	// Handle callback with ?success=github (from GitHub App flow)
	useEffect(() => {
		if (searchParams.get("success") === "github") {
			// A new connection was created, let ConnectionSelector show it
			// Clean up URL but stay in selecting state - user needs to confirm selection
			window.history.replaceState({}, "", "/device-github");
		}
	}, [searchParams]);

	const handleConfirm = () => {
		if (selectionState.type === "selecting" && selectionState.pendingId) {
			setSelectionState({ type: "confirming" });
			selectMutation.mutate({ connectionId: selectionState.pendingId });
		}
	};

	if (sessionLoading) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800">
				<Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
			</div>
		);
	}

	if (!session?.user) {
		// Redirect to login with return URL
		const returnUrl = encodeURIComponent("/device-github");
		if (typeof window !== "undefined") {
			window.location.href = `/sign-in?redirect=${returnUrl}`;
		}
		return (
			<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800">
				<p className="text-zinc-400">Redirecting to login...</p>
			</div>
		);
	}

	// Success state - connection selected
	if (selectionState.type === "connected") {
		return (
			<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 p-4">
				<Card className="w-full max-w-md bg-zinc-800/50 border-zinc-700">
					<CardContent className="pt-8">
						<div className="text-center space-y-4 py-4">
							<div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
								<CheckCircle2 className="h-8 w-8 text-emerald-500" />
							</div>
							<div>
								<h3 className="text-lg font-medium text-zinc-100">GitHub Connected!</h3>
								<p className="text-sm text-zinc-400 mt-1">
									You can close this window and return to your terminal.
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	// Success state - local git selected
	if (selectionState.type === "local-git") {
		return (
			<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 p-4">
				<Card className="w-full max-w-md bg-zinc-800/50 border-zinc-700">
					<CardContent className="pt-8">
						<div className="text-center space-y-4 py-4">
							<div className="mx-auto w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center">
								<Laptop className="h-8 w-8 text-blue-500" />
							</div>
							<div>
								<h3 className="text-lg font-medium text-zinc-100">Using Local Git Credentials</h3>
								<p className="text-sm text-zinc-400 mt-1">
									Your local git credentials will be used for authentication. You can close this
									window and return to your terminal.
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	// Selection state (including confirming)
	const isConfirming = selectionState.type === "confirming";
	const pendingId = selectionState.type === "selecting" ? selectionState.pendingId : null;

	return (
		<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 p-4">
			<Card className="w-full max-w-md bg-zinc-800/50 border-zinc-700">
				<CardContent className="pt-8">
					<div className="space-y-6">
						<div className="text-center space-y-2">
							<div className="mx-auto w-16 h-16 rounded-full bg-zinc-700/50 flex items-center justify-center">
								<GithubIcon className="h-8 w-8 text-zinc-100" />
							</div>
							<div>
								<h3 className="text-lg font-medium text-zinc-100">Connect GitHub</h3>
								<p className="text-sm text-zinc-400 mt-1">
									Choose a GitHub connection for this directory.
								</p>
							</div>
						</div>

						<div className="space-y-2">
							<Label className="text-xs text-zinc-400">GitHub Connection</Label>
							<ConnectionSelector
								provider="github"
								selectedId={pendingId}
								onSelect={(connectionId) => {
									setSelectionState({ type: "selecting", pendingId: connectionId });
								}}
								showLocalGitOption={true}
								onSelectLocalGit={() => {
									setSelectionState({ type: "selecting", pendingId: "local-git" });
								}}
								returnUrl={cliOrgId ? `/device-github?orgId=${cliOrgId}` : "/device-github"}
								autoSelectSingle={false}
							/>
						</div>

						<Button
							onClick={handleConfirm}
							disabled={!pendingId || isConfirming}
							className="w-full"
						>
							{isConfirming ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin mr-2" />
									Confirming...
								</>
							) : (
								"Confirm Selection"
							)}
						</Button>

						<p className="text-xs text-zinc-500 text-center">Signed in as {session.user.email}</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export default function DeviceGitHubPage() {
	return (
		<Suspense
			fallback={
				<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800">
					<Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
				</div>
			}
		>
			<DeviceGitHubContent />
		</Suspense>
	);
}
