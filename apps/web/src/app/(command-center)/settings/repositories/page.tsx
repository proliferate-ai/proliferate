import { redirect } from "next/navigation";

export default function RepositoriesRedirect() {
	redirect("/settings/environments");
}
