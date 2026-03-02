import { redirect } from "next/navigation";

export default function DashboardRepositoriesLegacyPage() {
	redirect("/settings/repositories");
}
