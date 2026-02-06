import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import {
	namespace as appNamespace,
	imageTag,
	ingressAnnotations,
	ingressClassName,
	ingressEnabled,
	ingressHost,
	ingressTlsSecretName,
} from "./config";

export interface AppReleaseInputs {
	k8sProvider: k8s.Provider;
	chartPath: string;
	imageRepos: {
		web: pulumi.Input<string>;
		gateway: pulumi.Input<string>;
		worker: pulumi.Input<string>;
		llmProxy: pulumi.Input<string>;
		triggerService: pulumi.Input<string>;
	};
	envSecretName: pulumi.Input<string>;
	llmProxyEnvSecretName: pulumi.Input<string>;
	gatewayServiceAccountName: string;
	gatewayServiceAccountAnnotations: Record<string, pulumi.Input<string>>;
	namespaceDependency?: pulumi.Resource;
}

export function deployApplications(inputs: AppReleaseInputs): k8s.helm.v3.Release {
	const gatewayServiceAccount = new k8s.core.v1.ServiceAccount(
		"gateway-service-account",
		{
			metadata: {
				name: inputs.gatewayServiceAccountName,
				namespace: appNamespace,
				annotations: inputs.gatewayServiceAccountAnnotations,
			},
		},
		{
			provider: inputs.k8sProvider,
			dependsOn: inputs.namespaceDependency ? [inputs.namespaceDependency] : [],
		},
	);

	const ingressTls =
		ingressHost && ingressTlsSecretName
			? [{ hosts: [ingressHost], secretName: ingressTlsSecretName }]
			: [];

	return new k8s.helm.v3.Release(
		"proliferate-apps",
		{
			chart: inputs.chartPath,
			namespace: appNamespace,
			createNamespace: false,
			// Ensure hook Jobs (e.g. pre-upgrade DB migrations) complete before considering the
			// release successful. Without this, Pulumi can report success while migrations are
			// still running (or have failed), leading to schema/code mismatches in prod.
			waitForJobs: true,
			values: {
				image: {
					web: { repository: inputs.imageRepos.web, tag: imageTag },
					gateway: { repository: inputs.imageRepos.gateway, tag: imageTag },
					worker: { repository: inputs.imageRepos.worker, tag: imageTag },
					llmProxy: { repository: inputs.imageRepos.llmProxy, tag: imageTag },
					triggerService: {
						repository: inputs.imageRepos.triggerService,
						tag: imageTag,
					},
				},
				env: {
					secretName: inputs.envSecretName,
					llmProxySecretName: inputs.llmProxyEnvSecretName,
				},
				serviceAccount: {
					gateway: {
						name: gatewayServiceAccount.metadata.name,
						create: false,
					},
				},
				ingress: {
					enabled: ingressEnabled,
					className: ingressClassName,
					host: ingressHost,
					annotations: ingressAnnotations,
					tls: ingressTls,
				},
			},
		},
		{ provider: inputs.k8sProvider, dependsOn: [gatewayServiceAccount] },
	);
}
