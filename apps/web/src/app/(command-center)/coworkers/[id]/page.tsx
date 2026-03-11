"use client";

import { LoadingDots } from "@/components/ui/loading-dots";
import { useWorker } from "@/hooks/automations/use-workers";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";

export default function CoworkerDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	const router = useRouter();
	const { data: worker, isLoading } = useWorker(id);

	useEffect(() => {
		if (worker?.managerSessionId) {
			router.replace(`/workspace/${worker.managerSessionId}`);
		}
	}, [worker?.managerSessionId, router]);

	if (isLoading) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	if (!worker) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<p className="text-sm text-destructive">Coworker not found</p>
			</div>
		);
	}

	return (
		<div className="flex-1 flex items-center justify-center">
			<LoadingDots size="md" className="text-muted-foreground" />
		</div>
	);
}
