"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function SecretsRedirect() {
	const router = useRouter();
	useEffect(() => {
		router.replace("/settings/environments");
	}, [router]);
	return null;
}
