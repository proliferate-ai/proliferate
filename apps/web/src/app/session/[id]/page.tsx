"use client";

export const dynamic = "force-dynamic";

import { CodingSession } from "@/components/coding-session";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function SessionPage() {
	const { id } = useParams();

	return (
		<div className="h-screen">
			<CodingSession
				sessionId={id as string}
				headerSlot={
					<Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
						&larr; Back to Dashboard
					</Link>
				}
			/>
		</div>
	);
}
