import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { ingressAnnotations, ingressClassName } from "./config";

export interface AddonsOutputs {
	ingressRelease?: k8s.helm.v3.Release;
	externalSecretsRelease?: k8s.helm.v3.Release;
	ingressHostname?: pulumi.Output<string>;
}

export function installIngressController(k8sProvider: k8s.Provider): {
	release: k8s.helm.v3.Release;
	hostname: pulumi.Output<string>;
} {
	const release = new k8s.helm.v3.Release(
		"ingress-nginx",
		{
			name: "ingress-nginx",
			chart: "ingress-nginx",
			repositoryOpts: { repo: "https://kubernetes.github.io/ingress-nginx" },
			namespace: "ingress-nginx",
			createNamespace: true,
			timeout: 900,
			values: {
				controller: {
					ingressClassResource: {
						name: ingressClassName,
						enabled: true,
					},
					service: {
						type: "LoadBalancer",
						annotations: ingressAnnotations,
					},
				},
			},
		},
		{ provider: k8sProvider },
	);

	const hostname = pulumi.output("");

	return { release, hostname };
}

export function installExternalSecrets(
	k8sProvider: k8s.Provider,
	serviceAccountAnnotations: Record<string, pulumi.Input<string>>,
): k8s.helm.v3.Release {
	return new k8s.helm.v3.Release(
		"external-secrets",
		{
			name: "external-secrets",
			chart: "external-secrets",
			repositoryOpts: { repo: "https://charts.external-secrets.io" },
			namespace: "external-secrets",
			createNamespace: true,
			timeout: 900,
			values: {
				installCRDs: true,
				serviceAccount: {
					create: true,
					name: "external-secrets",
					annotations: serviceAccountAnnotations,
				},
			},
		},
		{ provider: k8sProvider },
	);
}
