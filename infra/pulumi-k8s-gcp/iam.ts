import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import { namePrefix, projectId } from "./config";

export function createExternalSecretsServiceAccount() {
	const rawId = `ext-${namePrefix}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
	const trimmed = rawId.slice(0, 28).replace(/-+$/g, "");
	const accountId = trimmed.length >= 5 ? trimmed : "ext-secrets";
	const serviceAccount = new gcp.serviceaccount.Account("external-secrets-sa", {
		accountId,
		displayName: `${namePrefix} External Secrets`,
	});

	new gcp.projects.IAMMember("external-secrets-secret-access", {
		project: projectId,
		role: "roles/secretmanager.secretAccessor",
		member: pulumi.interpolate`serviceAccount:${serviceAccount.email}`,
	});

	return serviceAccount;
}

export function bindWorkloadIdentity(options: {
	resourceName: string;
	serviceAccountId: pulumi.Input<string>;
	k8sNamespace: string;
	k8sServiceAccount: string;
	dependsOn?: pulumi.Resource[];
}) {
	return new gcp.serviceaccount.IAMMember(
		options.resourceName,
		{
			serviceAccountId: options.serviceAccountId,
			role: "roles/iam.workloadIdentityUser",
			member: pulumi.interpolate`serviceAccount:${projectId}.svc.id.goog[${options.k8sNamespace}/${options.k8sServiceAccount}]`,
		},
		options.dependsOn ? { dependsOn: options.dependsOn } : undefined,
	);
}
