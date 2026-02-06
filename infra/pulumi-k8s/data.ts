import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {
	dbAllocatedStorage,
	dbEngineVersion,
	dbInstanceClass,
	dbMultiAz,
	dbName,
	dbPassword,
	dbUsername,
	namePrefix,
	provider,
	redisNodeType,
	redisNumNodes,
	s3BucketName,
} from "./config";
import type { NetworkOutputs } from "./network";

export interface DataOutputs {
	database: aws.rds.Instance;
	redis: aws.elasticache.ReplicationGroup;
	s3Bucket: aws.s3.Bucket;
	dbSecurityGroup: aws.ec2.SecurityGroup;
	redisSecurityGroup: aws.ec2.SecurityGroup;
}

export function createDataServices(network: NetworkOutputs): DataOutputs {
	const dbSecurityGroup = new aws.ec2.SecurityGroup(
		"db-sg",
		{
			vpcId: network.vpc.id,
			description: "Allow Postgres access from VPC",
			ingress: [
				{
					protocol: "tcp",
					fromPort: 5432,
					toPort: 5432,
					cidrBlocks: [network.vpc.cidrBlock],
				},
			],
			egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
			tags: { Name: `${namePrefix}-db-sg` },
		},
		{ provider },
	);

	const redisSecurityGroup = new aws.ec2.SecurityGroup(
		"redis-sg",
		{
			vpcId: network.vpc.id,
			description: "Allow Redis access from VPC",
			ingress: [
				{
					protocol: "tcp",
					fromPort: 6379,
					toPort: 6379,
					cidrBlocks: [network.vpc.cidrBlock],
				},
			],
			egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
			tags: { Name: `${namePrefix}-redis-sg` },
		},
		{ provider },
	);

	const dbSubnetGroup = new aws.rds.SubnetGroup(
		"db-subnets",
		{
			subnetIds: network.privateSubnets.map((subnet) => subnet.id),
			tags: { Name: `${namePrefix}-db-subnets` },
		},
		{ provider },
	);

	const database = new aws.rds.Instance(
		"postgres",
		{
			engine: "postgres",
			engineVersion: dbEngineVersion,
			instanceClass: dbInstanceClass,
			allocatedStorage: dbAllocatedStorage,
			dbSubnetGroupName: dbSubnetGroup.name,
			vpcSecurityGroupIds: [dbSecurityGroup.id],
			username: dbUsername,
			password: dbPassword,
			dbName,
			multiAz: dbMultiAz,
			skipFinalSnapshot: true,
			storageEncrypted: true,
			tags: { Name: `${namePrefix}-postgres` },
		},
		{ provider },
	);

	const redisSubnetGroup = new aws.elasticache.SubnetGroup(
		"redis-subnets",
		{
			subnetIds: network.privateSubnets.map((subnet) => subnet.id),
			description: "Redis subnet group",
			name: `${namePrefix}-redis-subnets`,
		},
		{ provider },
	);

	// BullMQ requires `noeviction` so Redis never evicts job data under memory pressure.
	const redisParameterGroup = new aws.elasticache.ParameterGroup(
		"redis-bullmq-params",
		{
			name: `${namePrefix}-redis-bullmq`,
			description: "BullMQ parameter group (noeviction)",
			family: "redis7",
			parameters: [{ name: "maxmemory-policy", value: "noeviction" }],
		},
		{ provider },
	);

	const redis = new aws.elasticache.ReplicationGroup(
		"redis",
		{
			description: "Proliferate Redis",
			engine: "redis",
			nodeType: redisNodeType,
			numCacheClusters: redisNumNodes,
			subnetGroupName: redisSubnetGroup.name,
			parameterGroupName: redisParameterGroup.name,
			securityGroupIds: [redisSecurityGroup.id],
			port: 6379,
			automaticFailoverEnabled: redisNumNodes > 1,
			atRestEncryptionEnabled: true,
			transitEncryptionEnabled: false,
			tags: { Name: `${namePrefix}-redis` },
		},
		{ provider },
	);

	const s3Bucket = new aws.s3.Bucket(
		"verification-bucket",
		{
			bucket: s3BucketName,
			forceDestroy: true,
			tags: { Name: `${namePrefix}-verification` },
		},
		{ provider },
	);

	new aws.s3.BucketPublicAccessBlock(
		"verification-bucket-block",
		{
			bucket: s3Bucket.id,
			blockPublicAcls: true,
			blockPublicPolicy: true,
			ignorePublicAcls: true,
			restrictPublicBuckets: true,
		},
		{ provider },
	);

	new aws.s3.BucketServerSideEncryptionConfigurationV2(
		"verification-bucket-encryption",
		{
			bucket: s3Bucket.id,
			rules: [
				{
					applyServerSideEncryptionByDefault: {
						sseAlgorithm: "AES256",
					},
				},
			],
		},
		{ provider },
	);

	return {
		database,
		redis,
		s3Bucket,
		dbSecurityGroup,
		redisSecurityGroup,
	};
}

export function createEcrRepository(name: string): aws.ecr.Repository {
	return new aws.ecr.Repository(
		name,
		{
			name: `${namePrefix}-${name}`,
			imageScanningConfiguration: { scanOnPush: true },
			tags: { Name: `${namePrefix}-${name}` },
		},
		{ provider },
	);
}
