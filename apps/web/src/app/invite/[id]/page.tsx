"use client";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { organization, useSession } from "@/lib/auth-client";
import { Check, Clock, Users, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface InvitationDetails {
	id: string;
	email: string;
	role: string;
	status: string;
	expiresAt: string;
	organization: {
		id: string;
		name: string;
		logo?: string;
	};
	inviter: {
		name: string;
		email: string;
	};
}

export default function InviteAcceptPage() {
	const router = useRouter();
	const params = useParams();
	const invitationId = params.id as string;
	const { data: session, isPending: sessionPending } = useSession();

	const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [accepting, setAccepting] = useState(false);
	const [rejecting, setRejecting] = useState(false);

	useEffect(() => {
		async function fetchInvitation() {
			try {
				const result = await organization.getInvitation({ query: { id: invitationId } });
				if (result.data) {
					setInvitation(result.data as unknown as InvitationDetails);
				} else {
					setError("Invitation not found or has expired");
				}
			} catch (err) {
				console.error("Failed to fetch invitation:", err);
				setError("Failed to load invitation");
			} finally {
				setLoading(false);
			}
		}

		if (invitationId) {
			fetchInvitation();
		}
	}, [invitationId]);

	const handleAccept = async () => {
		if (!invitation) return;

		setAccepting(true);
		try {
			await organization.acceptInvitation({ invitationId });
			router.push("/dashboard");
		} catch (err) {
			console.error("Failed to accept invitation:", err);
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
		} catch (err) {
			console.error("Failed to reject invitation:", err);
			setError("Failed to reject invitation");
		} finally {
			setRejecting(false);
		}
	};

	// Redirect to sign-in if not authenticated
	useEffect(() => {
		if (!sessionPending && !session) {
			const returnUrl = encodeURIComponent(`/invite/${invitationId}`);
			router.push(`/sign-in?returnUrl=${returnUrl}`);
		}
	}, [session, sessionPending, invitationId, router]);

	if (sessionPending || loading) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background">
				<div className="text-center">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
					<Text variant="body" color="muted" className="mt-4">
						Loading invitation...
					</Text>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background">
				<div className="max-w-md text-center p-8">
					<div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
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

	if (!invitation) {
		return null;
	}

	const isExpired = new Date(invitation.expiresAt) < new Date();

	return (
		<div className="min-h-screen flex items-center justify-center bg-background">
			<div className="max-w-md w-full p-8">
				<div className="text-center mb-8">
					{invitation.organization.logo ? (
						<img
							src={invitation.organization.logo}
							alt={invitation.organization.name}
							className="h-16 w-16 rounded-full mx-auto mb-4"
						/>
					) : (
						<div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
							<Users className="h-8 w-8 text-muted-foreground" />
						</div>
					)}
					<Text variant="h3" className="mb-2">
						Join {invitation.organization.name}
					</Text>
					<Text variant="body" color="muted">
						{invitation.inviter.name} has invited you to join as a{" "}
						<Text as="span" className="font-medium text-foreground">
							{invitation.role}
						</Text>
					</Text>
				</div>

				<div className="border border-border rounded-lg p-4 mb-6">
					<div className="flex items-center justify-between text-sm">
						<Text variant="small" color="muted">
							Invited by
						</Text>
						<Text variant="small">{invitation.inviter.name}</Text>
					</div>
					<div className="flex items-center justify-between text-sm mt-2">
						<Text variant="small" color="muted">
							Your role
						</Text>
						<Text variant="small" className="capitalize">
							{invitation.role}
						</Text>
					</div>
					<div className="flex items-center justify-between text-sm mt-2">
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
									<Check className="h-4 w-4 mr-2" />
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
