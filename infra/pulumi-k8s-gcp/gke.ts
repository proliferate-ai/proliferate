import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import {
	clusterName,
	kubernetesVersion,
	location,
	namePrefix,
	nodeInitialCount,
	nodeMachineType,
	nodeMaxCount,
	nodeMinCount,
	projectId,
} from "./config";
import { makeServiceAccountId } from "./naming";
import type { NetworkOutputs } from "./network";

export interface ClusterOutputs {
	cluster: gcp.container.Cluster;
	nodePool: gcp.container.NodePool;
	kubeconfig: pulumi.Output<string>;
	nodeServiceAccount: gcp.serviceaccount.Account;
}

export function createGkeCluster(network: NetworkOutputs): ClusterOutputs {
	const nodeServiceAccount = new gcp.serviceaccount.Account("gke-nodes", {
		accountId: makeServiceAccountId(namePrefix, "gke-nodes"),
		displayName: `${namePrefix} GKE nodes`,
	});

	const nodeRoles = [
		"roles/logging.logWriter",
		"roles/monitoring.metricWriter",
		"roles/monitoring.viewer",
		"roles/stackdriver.resourceMetadata.writer",
		"roles/artifactregistry.reader",
	];
	for (const role of nodeRoles) {
		new gcp.projects.IAMMember(`node-${role.split("/").pop()}`, {
			project: projectId,
			role,
			member: pulumi.interpolate`serviceAccount:${nodeServiceAccount.email}`,
		});
	}

	const cluster = new gcp.container.Cluster("cluster", {
		name: clusterName,
		location,
		network: network.network.id,
		subnetwork: network.subnet.id,
		removeDefaultNodePool: true,
		initialNodeCount: 1,
		releaseChannel: { channel: "REGULAR" },
		...(kubernetesVersion ? { minMasterVersion: kubernetesVersion } : {}),
		loggingService: "logging.googleapis.com/kubernetes",
		monitoringService: "monitoring.googleapis.com/kubernetes",
		workloadIdentityConfig: {
			workloadPool: `${projectId}.svc.id.goog`,
		},
		privateClusterConfig: {
			enablePrivateNodes: true,
			enablePrivateEndpoint: false,
			masterIpv4CidrBlock: "172.16.0.0/28",
		},
		ipAllocationPolicy: {
			clusterSecondaryRangeName: `${namePrefix}-pods`,
			servicesSecondaryRangeName: `${namePrefix}-services`,
		},
		masterAuthorizedNetworksConfig: {
			cidrBlocks: [{ cidrBlock: "0.0.0.0/0", displayName: "public" }],
		},
	});

	const nodePool = new gcp.container.NodePool(
		"primary-nodes",
		{
			cluster: cluster.name,
			location,
			initialNodeCount: nodeInitialCount,
			management: {
				autoRepair: true,
				autoUpgrade: true,
			},
			autoscaling: {
				minNodeCount: nodeMinCount,
				maxNodeCount: nodeMaxCount,
			},
			nodeConfig: {
				machineType: nodeMachineType,
				serviceAccount: nodeServiceAccount.email,
				oauthScopes: ["https://www.googleapis.com/auth/cloud-platform"],
				metadata: {
					"disable-legacy-endpoints": "true",
				},
				labels: { stack: namePrefix },
			},
		},
		{
			// Avoid GCP API errors on no-op node pool updates.
			ignoreChanges: ["nodeConfig", "management", "autoscaling"],
		},
	);

	const kubeconfig = pulumi
		.all([cluster.endpoint, cluster.masterAuth])
		.apply(([endpoint, masterAuth]) =>
			JSON.stringify({
				apiVersion: "v1",
				clusters: [
					{
						name: "gke",
						cluster: {
							server: `https://${endpoint}`,
							"certificate-authority-data": masterAuth.clusterCaCertificate,
						},
					},
				],
				contexts: [
					{
						name: "gke",
						context: { cluster: "gke", user: "gke" },
					},
				],
				"current-context": "gke",
				kind: "Config",
				users: [
					{
						name: "gke",
						user: {
							exec: {
								apiVersion: "client.authentication.k8s.io/v1beta1",
								command: "gke-gcloud-auth-plugin",
								provideClusterInfo: true,
							},
						},
					},
				],
			}),
		);

	return { cluster, nodePool, kubeconfig, nodeServiceAccount };
}
