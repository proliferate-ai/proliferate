"use client";

import { organization, signOut, useSession } from "@/lib/auth/client";
import { deletePersonalOrg, getBasicInviteInfo } from "@/lib/invite/actions";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export interface InvitationDetails {
	id: string;
	email: string;
	role: string;
	status: string;
	expiresAt: string;
	organizationId: string;
	organizationName: string;
	organizationSlug: string;
	inviterId: string;
	inviterEmail: string;
}

interface UseInvitationState {
	invitedEmail: string | null;
	organizationName: string | null;
	basicInfoLoaded: boolean;
	invitation: InvitationDetails | null;
	error: string | null;
	accepting: boolean;
	rejecting: boolean;
	signingOut: boolean;
}

export function useInvitation(invitationId: string) {
	const router = useRouter();
	const { data: session, isPending: sessionPending } = useSession();

	const [state, setState] = useState<UseInvitationState>({
		invitedEmail: null,
		organizationName: null,
		basicInfoLoaded: false,
		invitation: null,
		error: null,
		accepting: false,
		rejecting: false,
		signingOut: false,
	});

	// Step 1: Fetch basic invite info (no auth needed)
	useEffect(() => {
		let aborted = false;
		getBasicInviteInfo(invitationId)
			.then((info) => {
				if (aborted) return;
				if (info) {
					setState((s) => ({
						...s,
						invitedEmail: info.email,
						organizationName: info.organizationName,
						basicInfoLoaded: true,
					}));
				} else {
					setState((s) => ({
						...s,
						error: "Invitation not found or has expired",
						basicInfoLoaded: true,
					}));
				}
			})
			.catch(() => {
				if (aborted) return;
				setState((s) => ({
					...s,
					error: "Failed to load invitation",
					basicInfoLoaded: true,
				}));
			});
		return () => {
			aborted = true;
		};
	}, [invitationId]);

	// Step 2: Route based on session + email match
	useEffect(() => {
		if (!state.basicInfoLoaded || !state.invitedEmail || sessionPending) return;

		if (!session) {
			const redirect = encodeURIComponent(`/invite/${invitationId}`);
			const email = encodeURIComponent(state.invitedEmail);
			router.push(`/sign-in?redirect=${redirect}&email=${email}`);
			return;
		}

		if (session.user.email.toLowerCase() !== state.invitedEmail.toLowerCase()) {
			return;
		}

		let aborted = false;
		organization
			.getInvitation({ query: { id: invitationId } })
			.then((result) => {
				if (aborted) return;
				if (result.data) {
					setState((s) => ({
						...s,
						invitation: result.data as unknown as InvitationDetails,
					}));
				} else {
					setState((s) => ({ ...s, error: "Invitation not found or has expired" }));
				}
			})
			.catch(() => {
				if (aborted) return;
				setState((s) => ({ ...s, error: "Failed to load invitation details" }));
			});
		return () => {
			aborted = true;
		};
	}, [session, sessionPending, state.invitedEmail, state.basicInfoLoaded, invitationId, router]);

	const handleAccept = async () => {
		if (!state.invitation) return;
		setState((s) => ({ ...s, accepting: true }));
		try {
			await organization.acceptInvitation({ invitationId });
			await organization.setActive({ organizationId: state.invitation.organizationId });

			try {
				await deletePersonalOrg();
			} catch {
				// Non-critical -- personal org stays if deletion fails
			}

			const orgName = encodeURIComponent(state.invitation.organizationName);
			router.push(`/sessions?joined=${orgName}`);
		} catch {
			setState((s) => ({
				...s,
				error: "Failed to accept invitation. You may need to verify your email first.",
			}));
		} finally {
			setState((s) => ({ ...s, accepting: false }));
		}
	};

	const handleReject = async () => {
		if (!state.invitation) return;
		setState((s) => ({ ...s, rejecting: true }));
		try {
			await organization.rejectInvitation({ invitationId });
			router.push("/onboarding");
		} catch {
			setState((s) => ({ ...s, error: "Failed to reject invitation" }));
		} finally {
			setState((s) => ({ ...s, rejecting: false }));
		}
	};

	const handleSignOutAndRetry = async () => {
		if (!state.invitedEmail) return;
		setState((s) => ({ ...s, signingOut: true }));
		try {
			await signOut();
			const redirect = encodeURIComponent(`/invite/${invitationId}`);
			const email = encodeURIComponent(state.invitedEmail);
			router.push(`/sign-in?redirect=${redirect}&email=${email}`);
		} catch {
			setState((s) => ({ ...s, error: "Failed to sign out. Please try again." }));
		} finally {
			setState((s) => ({ ...s, signingOut: false }));
		}
	};

	return {
		session,
		sessionPending,
		invitation: state.invitation,
		invitedEmail: state.invitedEmail,
		organizationName: state.organizationName,
		basicInfoLoaded: state.basicInfoLoaded,
		error: state.error,
		accepting: state.accepting,
		rejecting: state.rejecting,
		signingOut: state.signingOut,
		handleAccept,
		handleReject,
		handleSignOutAndRetry,
	};
}
