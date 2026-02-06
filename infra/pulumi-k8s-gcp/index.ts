import "source-map-support/register";
import * as path from "node:path";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { installExternalSecrets, installIngressController } from "./addons";
import { deployApplications } from "./apps";
import {
	appEnvSecretName,
	artifactRepositoryId,
	clusterName,
	dbName,
	dbPassword,
	dbUsername,
	deployApps,
	enableGcsHmac,
	externalSecretsEnabled,
	externalSecretsStoreEnabled,
	ingressEnabled,
	llmProxyEnvSecretName,
	location,
	namespace,
	projectId,
	region,
} from "./config";
import { createDataServices } from "./data";
import { createClusterSecretStore, createExternalSecret } from "./external-secrets";
import { createGkeCluster } from "./gke";
import { bindWorkloadIdentity, createExternalSecretsServiceAccount } from "./iam";
import { createNetwork } from "./network";

const network = createNetwork();
const clusterOutputs = createGkeCluster(network);

const k8sProvider = new k8s.Provider("k8s", {
	kubeconfig: clusterOutputs.kubeconfig,
});

const appNamespace = new k8s.core.v1.Namespace(
	"proliferate-namespace",
	{ metadata: { name: namespace } },
	{ provider: k8sProvider },
);

const data = createDataServices(network);

const repo = new gcp.artifactregistry.Repository("artifact-repo", {
	repositoryId: artifactRepositoryId,
	format: "DOCKER",
	location: region,
	description: "Proliferate images",
});

const repoBaseUrl = pulumi.interpolate`${region}-docker.pkg.dev/${projectId}/${repo.repositoryId}`;
const webRepoUrl = pulumi.interpolate`${repoBaseUrl}/web`;
const gatewayRepoUrl = pulumi.interpolate`${repoBaseUrl}/gateway`;
const workerRepoUrl = pulumi.interpolate`${repoBaseUrl}/worker`;
const llmProxyRepoUrl = pulumi.interpolate`${repoBaseUrl}/llm-proxy`;
const triggerServiceRepoUrl = pulumi.interpolate`${repoBaseUrl}/trigger-service`;

const ingress = ingressEnabled ? installIngressController(k8sProvider) : undefined;

const externalSecretsSa = externalSecretsEnabled
	? createExternalSecretsServiceAccount()
	: undefined;
if (externalSecretsSa) {
	bindWorkloadIdentity({
		resourceName: "external-secrets-wi",
		serviceAccountId: externalSecretsSa.name,
		k8sNamespace: "external-secrets",
		k8sServiceAccount: "external-secrets",
		dependsOn: [clusterOutputs.cluster],
	});
}

bindWorkloadIdentity({
	resourceName: "gateway-gcs-wi",
	serviceAccountId: data.gcsAccessServiceAccount.name,
	k8sNamespace: namespace,
	k8sServiceAccount: "gateway",
	dependsOn: [clusterOutputs.cluster],
});

const externalSecretsRelease =
	externalSecretsEnabled && externalSecretsSa
		? installExternalSecrets(k8sProvider, {
				"iam.gke.io/gcp-service-account": externalSecretsSa.email,
			})
		: undefined;

if (externalSecretsEnabled && externalSecretsStoreEnabled && externalSecretsRelease) {
	const clusterSecretStore = createClusterSecretStore({
		k8sProvider,
		release: externalSecretsRelease,
		projectId,
		clusterName,
		clusterLocation: location,
	});

	createExternalSecret({
		externalSecretName: "proliferate-env",
		namespace,
		targetSecretName: "proliferate-env",
		remoteSecretName: appEnvSecretName,
		k8sProvider,
		dependsOn: [clusterSecretStore, appNamespace],
	});

	createExternalSecret({
		externalSecretName: "proliferate-llm-proxy-env",
		namespace,
		targetSecretName: "proliferate-llm-proxy-env",
		remoteSecretName: llmProxyEnvSecretName,
		k8sProvider,
		dependsOn: [clusterSecretStore, appNamespace],
	});
}

if (deployApps) {
	deployApplications({
		k8sProvider,
		chartPath: path.resolve(__dirname, "../helm/proliferate"),
		imageRepos: {
			web: webRepoUrl,
			gateway: gatewayRepoUrl,
			worker: workerRepoUrl,
			llmProxy: llmProxyRepoUrl,
			triggerService: triggerServiceRepoUrl,
		},
		envSecretName: "proliferate-env",
		llmProxyEnvSecretName: "proliferate-llm-proxy-env",
		gatewayServiceAccountName: "gateway",
		gatewayServiceAccountAnnotations: {
			"iam.gke.io/gcp-service-account": data.gcsAccessServiceAccount.email,
		},
		namespaceDependency: appNamespace,
	});
}

const databaseUrl = pulumi
	.all([data.database.privateIpAddress, dbName, dbPassword, dbUsername])
	.apply(
		([endpoint, name, password, username]) =>
			`postgresql://${username}:${password}@${endpoint}:5432/${name}`,
	);

const redisUrl = pulumi
	.all([data.redis.host, data.redis.port])
	.apply(([host, port]) => `redis://${host}:${port}`);

export const outputs = {
	projectId,
	clusterName,
	region,
	location,
	kubeconfig: clusterOutputs.kubeconfig,
	repoBaseUrl,
	webRepoUrl,
	gatewayRepoUrl,
	workerRepoUrl,
	llmProxyRepoUrl,
	triggerServiceRepoUrl,
	ingressHostname: ingress?.hostname ?? "",
	databaseEndpoint: data.database.privateIpAddress,
	databaseUrl,
	redisEndpoint: data.redis.host,
	redisUrl,
	s3Bucket: data.bucket.name,
	s3Region: "auto",
	s3EndpointUrl: "https://storage.googleapis.com",
	s3AccessKey: enableGcsHmac && data.hmacKey ? pulumi.secret(data.hmacKey.accessId) : "",
	s3SecretKey: enableGcsHmac && data.hmacKey ? pulumi.secret(data.hmacKey.secret) : "",
	appEnvSecretName,
	llmProxyEnvSecretName,
};
