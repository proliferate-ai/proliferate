"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function RepositoriesRedirect() {
	const router = useRouter();
	useEffect(() => {
		router.replace("/settings/environments");
	}, [router]);
	return null;
}
