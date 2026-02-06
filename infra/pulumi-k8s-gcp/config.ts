import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";

const cfg = new pulumi.Config();

export const projectId = cfg.get("projectId") ?? gcp.config.project ?? "";
if (!projectId) {
	throw new Error("Missing GCP projectId. Set config projectId or gcp:project.");
}

export const region = cfg.get("region") ?? gcp.config.region ?? "us-west1";
export const zone = cfg.get("zone") ?? gcp.config.zone ?? "us-west1-a";
export const location = cfg.get("location") ?? region;

export const stack = pulumi.getStack();
export const projectName = cfg.get("projectName") ?? "proliferate";
export const namePrefix = `${projectName}-${stack}`;

export const networkName = cfg.get("networkName") ?? `${namePrefix}-vpc`;
export const subnetCidr = cfg.get("subnetCidr") ?? "10.0.0.0/20";
export const podsCidr = cfg.get("podsCidr") ?? "10.4.0.0/14";
export const servicesCidr = cfg.get("servicesCidr") ?? "10.8.0.0/20";

export const clusterName = cfg.get("clusterName") ?? `${namePrefix}-gke`;
export const kubernetesVersion = cfg.get("kubernetesVersion");

export const nodeMachineType = cfg.get("nodeMachineType") ?? "e2-standard-4";
export const nodeMinCount = cfg.getNumber("nodeMinCount") ?? 1;
export const nodeMaxCount = cfg.getNumber("nodeMaxCount") ?? 3;
export const nodeInitialCount = cfg.getNumber("nodeInitialCount") ?? 1;

export const deployApps = cfg.getBoolean("deployApps") ?? false;
export const imageTag = cfg.get("imageTag") ?? "latest";

export const dbName = cfg.get("dbName") ?? "proliferate";
export const dbUsername = cfg.get("dbUsername") ?? "proliferate";
export const dbPassword = cfg.requireSecret("dbPassword");
export const dbTier = cfg.get("dbTier") ?? "db-custom-2-4096";
export const dbDiskSizeGb = cfg.getNumber("dbDiskSizeGb") ?? 20;
export const dbVersion = cfg.get("dbVersion") ?? "POSTGRES_15";
export const dbAvailabilityType = cfg.get("dbAvailabilityType") ?? "ZONAL";

export const redisMemoryGb = cfg.getNumber("redisMemoryGb") ?? 1;
export const redisTier = cfg.get("redisTier") ?? "BASIC";

export const enableGcsHmac = cfg.getBoolean("enableGcsHmac") ?? false;

export const artifactRepositoryId = cfg.get("artifactRepositoryId") ?? `${namePrefix}`;

export const bucketName = cfg.get("bucketName") ?? `${namePrefix}-verification`;

export const namespace = cfg.get("namespace") ?? "proliferate";
export const ingressClassName = cfg.get("ingressClassName") ?? "nginx";
export const ingressHost = cfg.get("ingressHost") ?? "";
export const ingressAnnotations = cfg.getObject<Record<string, string>>("ingressAnnotations") ?? {};

export const externalSecretsEnabled = cfg.getBoolean("externalSecretsEnabled") ?? true;
export const externalSecretsStoreEnabled = cfg.getBoolean("externalSecretsStoreEnabled") ?? true;
export const appEnvSecretName = cfg.get("appEnvSecretName") ?? `${namePrefix}-app-env`;
export const llmProxyEnvSecretName =
	cfg.get("llmProxyEnvSecretName") ?? `${namePrefix}-llm-proxy-env`;

export const ingressEnabled = cfg.getBoolean("ingressEnabled") ?? true;
