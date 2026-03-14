"use client";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";

export function InvitationError({ message }: { message: string }) {
	const router = useRouter();

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
					{message}
				</Text>
				<Button onClick={() => router.push("/sessions")}>Go to Sessions</Button>
			</div>
		</div>
	);
}
