import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import * as pulumi from "@pulumi/pulumi";
import {
	clusterName,
	kubernetesVersion,
	nodeDesiredCapacity,
	nodeInstanceType,
	nodeMaxSize,
	nodeMinSize,
	provider,
} from "./config";
import type { NetworkOutputs } from "./network";

export interface ClusterOutputs {
	cluster: eks.Cluster;
	kubeconfig: pulumi.Output<string>;
	nodeSecurityGroupId: pulumi.Output<string>;
	oidcProviderArn: pulumi.Output<string>;
	oidcProviderUrl: pulumi.Output<string>;
}

export function createEksCluster(network: NetworkOutputs): ClusterOutputs {
	const profileName = process.env.AWS_PROFILE ?? aws.config.profile;
	const providerCredentialOpts = profileName ? { profileName } : {};

	const cluster = new eks.Cluster(
		"cluster",
		{
			name: clusterName,
			version: kubernetesVersion,
			vpcId: network.vpc.id,
			publicSubnetIds: network.publicSubnets.map((subnet) => subnet.id),
			privateSubnetIds: network.privateSubnets.map((subnet) => subnet.id),
			instanceType: nodeInstanceType,
			desiredCapacity: nodeDesiredCapacity,
			minSize: nodeMinSize,
			maxSize: nodeMaxSize,
			createOidcProvider: true,
			endpointPublicAccess: true,
			endpointPrivateAccess: true,
			skipDefaultNodeGroup: true,
			providerCredentialOpts,
		},
		{ provider },
	);

	const nodeRole = cluster.instanceRoles.apply((roles) => roles[0]);
	new eks.ManagedNodeGroup(
		"default",
		{
			cluster,
			nodeRole,
			instanceTypes: [nodeInstanceType],
			scalingConfig: {
				desiredSize: nodeDesiredCapacity,
				minSize: nodeMinSize,
				maxSize: nodeMaxSize,
			},
		},
		{ provider },
	);

	const oidcProvider = cluster.core.oidcProvider;
	if (!oidcProvider) {
		throw new Error("EKS OIDC provider was not created");
	}

	const kubeconfig = pulumi
		.output(cluster.kubeconfig)
		.apply((config: any) => (typeof config === "string" ? config : JSON.stringify(config)));

	return {
		cluster,
		kubeconfig,
		nodeSecurityGroupId: cluster.nodeSecurityGroup.id,
		oidcProviderArn: oidcProvider.arn,
		oidcProviderUrl: oidcProvider.url,
	};
}
