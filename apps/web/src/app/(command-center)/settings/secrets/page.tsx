import { redirect } from "next/navigation";

export default function SecretsRedirect() {
	redirect("/settings/environments");
}
