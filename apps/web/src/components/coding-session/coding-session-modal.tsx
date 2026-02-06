"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useCreateSession } from "@/hooks/use-sessions";
import { useCodingSessionStore } from "@/stores/coding-session-store";
import { useEffect, useRef } from "react";
import { CodingSession } from "./coding-session";
import { SessionLoadingShell } from "./session-loading-shell";

export function CodingSessionModal() {
	const {
		isOpen,
		sessionId,
		prebuildId,
		sessionType,
		title,
		description,
		initialPrompt,
		initialImages,
		closeSession,
		setSessionId,
	} = useCodingSessionStore();

	const createMutation = useCreateSession();
	const creationStartedRef = useRef(false);

	// Create session if we have prebuildId but no sessionId
	useEffect(() => {
		if (!isOpen || sessionId || !prebuildId) return;
		if (creationStartedRef.current || createMutation.isPending || createMutation.isSuccess) return;

		creationStartedRef.current = true;

		createMutation
			.mutateAsync({ prebuildId, sessionType: sessionType || "coding" })
			.then((result) => {
				setSessionId(result.sessionId);
			})
			.catch(() => {
				creationStartedRef.current = false;
			});
	}, [isOpen, sessionId, prebuildId, sessionType, createMutation, setSessionId]);

	// Reset creation state when modal closes
	useEffect(() => {
		if (!isOpen) {
			creationStartedRef.current = false;
			createMutation.reset();
		}
	}, [isOpen, createMutation]);

	if (!isOpen) return null;

	// Creating state - show loading shell in modal
	if (!sessionId && prebuildId) {
		return (
			<Dialog open={isOpen} onOpenChange={(open) => !open && closeSession()}>
				<DialogContent className="max-w-4xl h-[85vh] p-0 gap-0 flex flex-col">
					<DialogTitle className="sr-only">{title || "Creating Session"}</DialogTitle>
					{createMutation.isError ? (
						<div className="flex h-full items-center justify-center">
							<div className="text-center space-y-4">
								<p className="text-destructive">
									{createMutation.error instanceof Error
										? createMutation.error.message
										: "Failed to create session"}
								</p>
								<Button
									variant="link"
									className="text-sm text-primary underline p-0 h-auto"
									onClick={() => {
										creationStartedRef.current = false;
										createMutation.reset();
									}}
								>
									Try again
								</Button>
							</div>
						</div>
					) : (
						<SessionLoadingShell
							mode="creating"
							initialPrompt={sessionType === "setup" ? initialPrompt : undefined}
						/>
					)}
				</DialogContent>
			</Dialog>
		);
	}

	// No sessionId and no prebuildId - shouldn't happen, close modal
	if (!sessionId) {
		return null;
	}

	// Display existing session
	return (
		<CodingSession
			sessionId={sessionId}
			title={title}
			description={description}
			initialPrompt={initialPrompt}
			initialImages={initialImages}
			asModal
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) closeSession();
			}}
		/>
	);
}
