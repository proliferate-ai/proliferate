"use client";

import { getBasicInviteInfo } from "@/app/invite/actions";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { organization, signOut, useSession } from "@/lib/auth-client";
import { Check, Clock, LogOut, Users, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface InvitationDetails {
	id: string;
	email: string;
	role: string;
	status: string;
	expiresAt: string;
	organization?: {
		id: string;
		name: string;
		logo?: string;
	};
	inviter?: {
		name: string;
		email: string;
	};
}

export default function InviteAcceptPage() {
	const router = useRouter();
	const params = useParams();
	const invitationId = params.id as string;
	const { data: session, isPending: sessionPending } = useSession();

	// Basic info fetched without auth (server action)
	const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
	const [organizationName, setOrganizationName] = useState<string | null>(null);
	const [basicInfoLoaded, setBasicInfoLoaded] = useState(false);

	// Full invitation from better-auth (requires auth + email match)
	const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [accepting, setAccepting] = useState(false);
	const [rejecting, setRejecting] = useState(false);
	const [signingOut, setSigningOut] = useState(false);

	// Step 1: Fetch basic invite info (no auth needed)
	useEffect(() => {
		getBasicInviteInfo(invitationId)
			.then((info) => {
				if (info) {
					setInvitedEmail(info.email);
					setOrganizationName(info.organizationName);
				} else {
					setError("Invitation not found or has expired");
				}
			})
			.catch(() => {
				setError("Failed to load invitation");
			})
			.finally(() => {
				setBasicInfoLoaded(true);
			});
	}, [invitationId]);

	// Step 2: Route based on session + email match
	useEffect(() => {
		if (!basicInfoLoaded || !invitedEmail || sessionPending) return;

		// Not logged in — redirect to sign-in with correct params
		if (!session) {
			const redirect = encodeURIComponent(`/invite/${invitationId}`);
			const email = encodeURIComponent(invitedEmail);
			router.push(`/sign-in?redirect=${redirect}&email=${email}`);
			return;
		}

		// Logged in but wrong email — let the render handle the mismatch UI
		if (session.user.email.toLowerCase() !== invitedEmail.toLowerCase()) {
			return;
		}

		// Logged in + correct email — fetch full invitation from better-auth
		organization
			.getInvitation({ query: { id: invitationId } })
			.then((result) => {
				if (result.data) {
					setInvitation(result.data as unknown as InvitationDetails);
				} else {
					setError("Invitation not found or has expired");
				}
			})
			.catch(() => {
				setError("Failed to load invitation details");
			});
	}, [session, sessionPending, invitedEmail, basicInfoLoaded, invitationId, router]);

	const handleAccept = async () => {
		if (!invitation) return;
		setAccepting(true);
		try {
			await organization.acceptInvitation({ invitationId });
			router.push("/dashboard");
		} catch {
			setError("Failed to accept invitation. You may need to verify your email first.");
		} finally {
			setAccepting(false);
		}
	};

	const handleReject = async () => {
		if (!invitation) return;
		setRejecting(true);
		try {
			await organization.rejectInvitation({ invitationId });
			router.push("/");
		} catch {
			setError("Failed to reject invitation");
		} finally {
			setRejecting(false);
		}
	};

	const handleSignOutAndRetry = async () => {
		if (!invitedEmail) return;
		setSigningOut(true);
		try {
			await signOut();
			const redirect = encodeURIComponent(`/invite/${invitationId}`);
			const email = encodeURIComponent(invitedEmail);
			router.push(`/sign-in?redirect=${redirect}&email=${email}`);
		} catch {
			setSigningOut(false);
		}
	};

	// Loading state — wait for both basic info and session
	if (!basicInfoLoaded || sessionPending) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background">
				<div className="text-center">
					<div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
					<Text variant="body" color="muted" className="mt-4">
						Loading invitation...
					</Text>
				</div>
			</div>
		);
	}

	// Error state
	if (error) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background">
				<div className="max-w-md p-8 text-center">
					<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/5">
						<X className="h-6 w-6 text-destructive" />
					</div>
					<Text variant="h4" className="mb-2">
						Invitation Error
					</Text>
					<Text variant="body" color="muted" className="mb-6">
						{error}
					</Text>
					<Button onClick={() => router.push("/dashboard")}>Go to Dashboard</Button>
				</div>
			</div>
		);
	}

	// Email mismatch — logged in with wrong email
	if (session && invitedEmail && session.user.email.toLowerCase() !== invitedEmail.toLowerCase()) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background">
				<div className="w-full max-w-md p-8">
					<div className="mb-8 text-center">
						<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
							<Users className="h-8 w-8 text-muted-foreground" />
						</div>
						<Text variant="h3" className="mb-2">
							Account Mismatch
						</Text>
						<Text variant="body" color="muted">
							This invitation to join{" "}
							<Text as="span" className="font-medium text-foreground">
								{organizationName}
							</Text>{" "}
							was sent to{" "}
							<Text as="span" className="font-medium text-foreground">
								{invitedEmail}
							</Text>
							, but you&apos;re signed in as{" "}
							<Text as="span" className="font-medium text-foreground">
								{session.user.email}
							</Text>
							.
						</Text>
					</div>

					<div className="flex flex-col gap-3">
						<Button onClick={handleSignOutAndRetry} disabled={signingOut} className="w-full">
							<LogOut className="mr-2 h-4 w-4" />
							{signingOut ? "Signing out..." : `Sign in as ${invitedEmail}`}
						</Button>
						<Button variant="outline" onClick={() => router.push("/dashboard")} className="w-full">
							Continue to Dashboard
						</Button>
					</div>
				</div>
			</div>
		);
	}

	// Waiting for full invitation to load
	if (!invitation) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background">
				<div className="text-center">
					<div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
					<Text variant="body" color="muted" className="mt-4">
						Loading invitation details...
					</Text>
				</div>
			</div>
		);
	}

	// Happy path — show invitation accept/decline UI
	const isExpired = new Date(invitation.expiresAt) < new Date();

	return (
		<div className="flex min-h-screen items-center justify-center bg-background">
			<div className="w-full max-w-md p-8">
				<div className="mb-8 text-center">
					{invitation.organization?.logo ? (
						<img
							src={invitation.organization.logo}
							alt={invitation.organization?.name ?? ""}
							className="mx-auto mb-4 h-16 w-16 rounded-full"
						/>
					) : (
						<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
							<Users className="h-8 w-8 text-muted-foreground" />
						</div>
					)}
					<Text variant="h3" className="mb-2">
						Join {invitation.organization?.name ?? "Organization"}
					</Text>
					<Text variant="body" color="muted">
						{invitation.inviter?.name ?? "Someone"} has invited you to join as a{" "}
						<Text as="span" className="font-medium text-foreground">
							{invitation.role}
						</Text>
					</Text>
				</div>

				<div className="mb-6 rounded-lg border border-border p-4">
					<div className="flex items-center justify-between text-sm">
						<Text variant="small" color="muted">
							Invited by
						</Text>
						<Text variant="small">{invitation.inviter?.name ?? "Unknown"}</Text>
					</div>
					<div className="mt-2 flex items-center justify-between text-sm">
						<Text variant="small" color="muted">
							Your role
						</Text>
						<Text variant="small" className="capitalize">
							{invitation.role}
						</Text>
					</div>
					<div className="mt-2 flex items-center justify-between text-sm">
						<Text variant="small" color="muted">
							Expires
						</Text>
						<Text variant="small" className="flex items-center gap-1">
							<Clock className="h-3 w-3" />
							{new Date(invitation.expiresAt).toLocaleDateString()}
						</Text>
					</div>
				</div>

				{isExpired ? (
					<div className="text-center">
						<Text variant="body" color="destructive" className="mb-4">
							This invitation has expired.
						</Text>
						<Button variant="outline" onClick={() => router.push("/dashboard")}>
							Go to Dashboard
						</Button>
					</div>
				) : (
					<div className="flex gap-3">
						<Button
							variant="outline"
							className="flex-1"
							onClick={handleReject}
							disabled={rejecting || accepting}
						>
							{rejecting ? "Declining..." : "Decline"}
						</Button>
						<Button className="flex-1" onClick={handleAccept} disabled={accepting || rejecting}>
							{accepting ? (
								"Accepting..."
							) : (
								<>
									<Check className="mr-2 h-4 w-4" />
									Accept Invitation
								</>
							)}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
