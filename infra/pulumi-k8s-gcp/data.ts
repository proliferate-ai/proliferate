import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import {
	bucketName,
	dbAvailabilityType,
	dbDiskSizeGb,
	dbName,
	dbPassword,
	dbTier,
	dbUsername,
	dbVersion,
	enableGcsHmac,
	namePrefix,
	projectId,
	redisMemoryGb,
	redisTier,
	region,
} from "./config";
import { makeServiceAccountId } from "./naming";
import type { NetworkOutputs } from "./network";

export interface DataOutputs {
	database: gcp.sql.DatabaseInstance;
	databaseUser: gcp.sql.User;
	databaseSchema: gcp.sql.Database;
	redis: gcp.redis.Instance;
	bucket: gcp.storage.Bucket;
	hmacKey?: gcp.storage.HmacKey;
	gcsAccessServiceAccount: gcp.serviceaccount.Account;
}

export function createDataServices(network: NetworkOutputs): DataOutputs {
	const bucket = new gcp.storage.Bucket("verification-bucket", {
		name: bucketName,
		location: region,
		uniformBucketLevelAccess: true,
		publicAccessPrevention: "enforced",
		forceDestroy: true,
	});

	const gcsAccessServiceAccount = new gcp.serviceaccount.Account("gcs-access", {
		accountId: makeServiceAccountId(namePrefix, "gcs-access"),
		displayName: `${namePrefix} GCS Access`,
	});

	new gcp.storage.BucketIAMMember("gcs-access", {
		bucket: bucket.name,
		role: "roles/storage.objectAdmin",
		member: pulumi.interpolate`serviceAccount:${gcsAccessServiceAccount.email}`,
	});

	const hmacKey = enableGcsHmac
		? new gcp.storage.HmacKey("gcs-hmac-key", {
				serviceAccountEmail: gcsAccessServiceAccount.email,
				project: projectId,
			})
		: undefined;

	const database = new gcp.sql.DatabaseInstance(
		"database",
		{
			name: `${namePrefix}-db`,
			region,
			databaseVersion: dbVersion,
			settings: {
				tier: dbTier,
				diskSize: dbDiskSizeGb,
				availabilityType: dbAvailabilityType,
				backupConfiguration: { enabled: true },
				ipConfiguration: {
					ipv4Enabled: false,
					sslMode: "ENCRYPTED_ONLY",
					privateNetwork: network.network.id,
				},
			},
		},
		{ dependsOn: [network.serviceNetworking] },
	);

	const databaseSchema = new gcp.sql.Database("database-schema", {
		instance: database.name,
		name: dbName,
	});

	const databaseUser = new gcp.sql.User("database-user", {
		instance: database.name,
		name: dbUsername,
		password: dbPassword,
	});

	const redis = new gcp.redis.Instance("redis", {
		name: `${namePrefix}-redis`,
		region,
		tier: redisTier,
		memorySizeGb: redisMemoryGb,
		authorizedNetwork: network.network.id,
		transitEncryptionMode: "DISABLED",
	});

	return {
		database,
		databaseUser,
		databaseSchema,
		redis,
		bucket,
		hmacKey,
		gcsAccessServiceAccount,
	};
}
