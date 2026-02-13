"use client";

export const dynamic = "force-dynamic";

import { CodingSession } from "@/components/coding-session";
import { useParams } from "next/navigation";

export default function SessionPage() {
	const { id } = useParams();

	return (
		<div className="h-screen">
			<CodingSession sessionId={id as string} />
		</div>
	);
}
