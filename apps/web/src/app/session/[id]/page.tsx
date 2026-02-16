"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Legacy redirect: /session/:id → /workspace/:id
 */
export default function LegacySessionRedirect() {
	const { id } = useParams();
	const router = useRouter();

	useEffect(() => {
		router.replace(`/workspace/${id}`);
	}, [id, router]);

	return null;
}
