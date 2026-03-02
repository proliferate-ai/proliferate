import { redirect } from "next/navigation";

export default async function DashboardAutomationLegacyPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	redirect(`/coworkers/${id}`);
}
