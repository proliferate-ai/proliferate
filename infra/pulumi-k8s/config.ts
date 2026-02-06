import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const cfg = new pulumi.Config();

export const projectName = cfg.get("projectName") ?? "proliferate";
export const stack = pulumi.getStack();
export const namePrefix = `${projectName}-${stack}`;

export const region = (cfg.get("region") ?? aws.config.region ?? "us-west-1") as aws.Region;
export const provider = new aws.Provider("aws", { region });

export const vpcCidr = cfg.get("vpcCidr") ?? "10.0.0.0/16";
export const availabilityZoneCount = cfg.getNumber("availabilityZoneCount") ?? 2;

export const clusterName = cfg.get("clusterName") ?? `${namePrefix}-eks`;
export const kubernetesVersion = cfg.get("kubernetesVersion") ?? "1.29";

export const nodeInstanceType = cfg.get("nodeInstanceType") ?? "t3.medium";
export const nodeMinSize = cfg.getNumber("nodeMinSize") ?? 2;
export const nodeMaxSize = cfg.getNumber("nodeMaxSize") ?? 4;
export const nodeDesiredCapacity = cfg.getNumber("nodeDesiredCapacity") ?? 2;

export const deployApps = cfg.getBoolean("deployApps") ?? false;
export const imageTag = cfg.get("imageTag") ?? "latest";

export const dbName = cfg.get("dbName") ?? "proliferate";
export const dbUsername = cfg.get("dbUsername") ?? "proliferate";
export const dbPassword = cfg.requireSecret("dbPassword");
export const dbEngineVersion = cfg.get("dbEngineVersion");
export const dbInstanceClass = cfg.get("dbInstanceClass") ?? "db.t4g.micro";
export const dbAllocatedStorage = cfg.getNumber("dbAllocatedStorage") ?? 20;
export const dbMultiAz = cfg.getBoolean("dbMultiAz") ?? false;

export const redisNodeType = cfg.get("redisNodeType") ?? "cache.t4g.micro";
export const redisNumNodes = cfg.getNumber("redisNumNodes") ?? 1;

export const s3BucketName = cfg.get("s3BucketName") ?? `${namePrefix}-verification`;

export const namespace = cfg.get("namespace") ?? "proliferate";
export const ingressClassName = cfg.get("ingressClassName") ?? "nginx";
export const ingressHost = cfg.get("ingressHost") ?? "";
export const ingressAnnotations = cfg.getObject<Record<string, string>>("ingressAnnotations") ?? {};
export const ingressTlsSecretName = cfg.get("ingressTlsSecretName") ?? "";

export const externalSecretsEnabled = cfg.getBoolean("externalSecretsEnabled") ?? true;
export const externalSecretsStoreEnabled = cfg.getBoolean("externalSecretsStoreEnabled") ?? true;
export const appEnvSecretName = cfg.get("appEnvSecretName") ?? `${namePrefix}-app-env`;
export const llmProxyEnvSecretName =
	cfg.get("llmProxyEnvSecretName") ?? `${namePrefix}-llm-proxy-env`;

export const ingressEnabled = cfg.getBoolean("ingressEnabled") ?? true;
