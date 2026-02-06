import "source-map-support/register";
import * as path from "node:path";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { installExternalSecrets, installIngressController } from "./addons";
import { deployApplications } from "./apps";
import {
	appEnvSecretName,
	clusterName,
	dbName,
	dbPassword,
	dbUsername,
	deployApps,
	externalSecretsEnabled,
	externalSecretsStoreEnabled,
	ingressEnabled,
	llmProxyEnvSecretName,
	namePrefix,
	namespace,
	provider,
	region,
} from "./config";
import { createDataServices, createEcrRepository } from "./data";
import { createEksCluster } from "./eks";
import { createClusterSecretStore, createExternalSecret } from "./external-secrets";
import { createExternalSecretsPolicy, createGatewayS3Policy, createIrsaRole } from "./iam";
import { createNetwork } from "./network";

const network = createNetwork();
const clusterOutputs = createEksCluster(network);

const k8sProvider = new k8s.Provider("k8s", {
	kubeconfig: clusterOutputs.kubeconfig,
});

const appNamespace = new k8s.core.v1.Namespace(
	"proliferate-namespace",
	{ metadata: { name: namespace } },
	{ provider: k8sProvider },
);

const data = createDataServices(network);

const webRepo = createEcrRepository("web");
const gatewayRepo = createEcrRepository("gateway");
const workerRepo = createEcrRepository("worker");
const llmProxyRepo = createEcrRepository("llm-proxy");
const triggerRepo = createEcrRepository("trigger-service");

const ingress = ingressEnabled ? installIngressController(k8sProvider) : undefined;

const accountId = aws
	.getCallerIdentity({}, { provider })
	.then((identity: aws.GetCallerIdentityResult) => identity.accountId);

const secretArns = pulumi
	.output(accountId)
	.apply((account: string) => [
		`arn:aws:secretsmanager:${region}:${account}:secret:${appEnvSecretName}*`,
		`arn:aws:secretsmanager:${region}:${account}:secret:${llmProxyEnvSecretName}*`,
	]);

const externalSecretsPolicy = createExternalSecretsPolicy(secretArns);
const externalSecretsRole = createIrsaRole({
	name: "external-secrets",
	oidcProviderArn: clusterOutputs.oidcProviderArn,
	oidcProviderUrl: clusterOutputs.oidcProviderUrl,
	namespace: "external-secrets",
	serviceAccountName: "external-secrets",
	policyArns: [externalSecretsPolicy.arn],
});

const gatewayS3Policy = createGatewayS3Policy(data.s3Bucket.arn);
const gatewayRole = createIrsaRole({
	name: "gateway",
	oidcProviderArn: clusterOutputs.oidcProviderArn,
	oidcProviderUrl: clusterOutputs.oidcProviderUrl,
	namespace,
	serviceAccountName: "gateway",
	policyArns: [gatewayS3Policy.arn],
});

const externalSecretsRelease = externalSecretsEnabled
	? installExternalSecrets(k8sProvider, {
			"eks.amazonaws.com/role-arn": externalSecretsRole.arn,
		})
	: undefined;

if (externalSecretsEnabled && externalSecretsStoreEnabled && externalSecretsRelease) {
	const clusterSecretStore = createClusterSecretStore({
		k8sProvider,
		release: externalSecretsRelease,
		region,
	});

	createExternalSecret({
		name: "proliferate-env",
		namespace,
		secretName: appEnvSecretName,
		k8sProvider,
		dependsOn: [clusterSecretStore, appNamespace],
	});

	createExternalSecret({
		name: "proliferate-llm-proxy-env",
		namespace,
		secretName: llmProxyEnvSecretName,
		k8sProvider,
		dependsOn: [clusterSecretStore, appNamespace],
	});
}

if (deployApps) {
	deployApplications({
		k8sProvider,
		chartPath: path.resolve(__dirname, "../helm/proliferate"),
		imageRepos: {
			web: webRepo.repositoryUrl,
			gateway: gatewayRepo.repositoryUrl,
			worker: workerRepo.repositoryUrl,
			llmProxy: llmProxyRepo.repositoryUrl,
			triggerService: triggerRepo.repositoryUrl,
		},
		envSecretName: "proliferate-env",
		llmProxyEnvSecretName: "proliferate-llm-proxy-env",
		gatewayServiceAccountName: "gateway",
		gatewayServiceAccountAnnotations: {
			"eks.amazonaws.com/role-arn": gatewayRole.arn,
		},
		namespaceDependency: appNamespace,
	});
}

const databaseUrl = pulumi
	.all([data.database.endpoint, dbName, dbPassword, dbUsername])
	.apply(
		([endpoint, name, password, username]: [string, string, string, string]) =>
			`postgresql://${username}:${password}@${
				endpoint.includes(":") ? endpoint : `${endpoint}:5432`
			}/${name}`,
	);

const redisUrl = data.redis.primaryEndpointAddress.apply(
	(endpoint: string) => `redis://${endpoint}:6379`,
);

export const outputs = {
	clusterName,
	kubeconfig: clusterOutputs.kubeconfig,
	region,
	vpcId: network.vpc.id,
	privateSubnetIds: network.privateSubnets.map((subnet) => subnet.id),
	publicSubnetIds: network.publicSubnets.map((subnet) => subnet.id),
	webRepoUrl: webRepo.repositoryUrl,
	gatewayRepoUrl: gatewayRepo.repositoryUrl,
	workerRepoUrl: workerRepo.repositoryUrl,
	llmProxyRepoUrl: llmProxyRepo.repositoryUrl,
	triggerServiceRepoUrl: triggerRepo.repositoryUrl,
	ingressHostname: ingress?.hostname ?? "",
	databaseEndpoint: data.database.endpoint,
	redisEndpoint: data.redis.primaryEndpointAddress,
	databaseUrl,
	redisUrl,
	s3Bucket: data.s3Bucket.bucket,
	appEnvSecretName,
	llmProxyEnvSecretName,
};
