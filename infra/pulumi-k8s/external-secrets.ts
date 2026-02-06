import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";

export function createClusterSecretStore(options: {
	k8sProvider: k8s.Provider;
	release: k8s.helm.v3.Release;
	region: string;
}): k8s.apiextensions.CustomResource {
	return new k8s.apiextensions.CustomResource(
		"aws-secretsmanager-store",
		{
			apiVersion: "external-secrets.io/v1",
			kind: "ClusterSecretStore",
			metadata: { name: "aws-secretsmanager" },
			spec: {
				provider: {
					aws: {
						service: "SecretsManager",
						region: options.region,
						auth: {
							jwt: {
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
	name: string;
	namespace: string;
	secretName: pulumi.Input<string>;
	k8sProvider: k8s.Provider;
	dependsOn?: pulumi.Resource[];
}): k8s.apiextensions.CustomResource {
	return new k8s.apiextensions.CustomResource(
		options.name,
		{
			apiVersion: "external-secrets.io/v1",
			kind: "ExternalSecret",
			metadata: {
				name: options.name,
				namespace: options.namespace,
			},
			spec: {
				refreshInterval: "1h",
				secretStoreRef: {
					name: "aws-secretsmanager",
					kind: "ClusterSecretStore",
				},
				target: {
					name: options.name,
					creationPolicy: "Owner",
				},
				dataFrom: [
					{
						extract: {
							key: options.secretName,
						},
					},
				],
			},
		},
		{ provider: options.k8sProvider, dependsOn: options.dependsOn },
	);
}
