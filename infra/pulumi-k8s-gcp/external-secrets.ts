import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";

export function createClusterSecretStore(options: {
	k8sProvider: k8s.Provider;
	release: k8s.helm.v3.Release;
	projectId: string;
	clusterName: string;
	clusterLocation: string;
}): k8s.apiextensions.CustomResource {
	return new k8s.apiextensions.CustomResource(
		"gcp-secretmanager-store",
		{
			apiVersion: "external-secrets.io/v1",
			kind: "ClusterSecretStore",
			metadata: { name: "gcp-secretmanager" },
			spec: {
				provider: {
					gcpsm: {
						projectID: options.projectId,
						auth: {
							workloadIdentity: {
								clusterProjectID: options.projectId,
								clusterLocation: options.clusterLocation,
								clusterName: options.clusterName,
								serviceAccountRef: {
									name: "external-secrets",
									namespace: "external-secrets",
								},
							},
						},
					},
				},
			},
		},
		{ provider: options.k8sProvider, dependsOn: [options.release] },
	);
}

export function createExternalSecret(options: {
	externalSecretName: string;
	namespace: string;
	targetSecretName: pulumi.Input<string>;
	remoteSecretName: pulumi.Input<string>;
	k8sProvider: k8s.Provider;
	dependsOn?: pulumi.Resource[];
}): k8s.apiextensions.CustomResource {
	return new k8s.apiextensions.CustomResource(
		options.externalSecretName,
		{
			apiVersion: "external-secrets.io/v1",
			kind: "ExternalSecret",
			metadata: {
				name: options.externalSecretName,
				namespace: options.namespace,
			},
			spec: {
				refreshInterval: "1h",
				secretStoreRef: {
					name: "gcp-secretmanager",
					kind: "ClusterSecretStore",
				},
				target: {
					name: options.targetSecretName,
					creationPolicy: "Owner",
				},
				dataFrom: [
					{
						extract: {
							key: options.remoteSecretName,
						},
					},
				],
			},
		},
		{ provider: options.k8sProvider, dependsOn: options.dependsOn },
	);
}
