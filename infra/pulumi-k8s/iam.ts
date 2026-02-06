import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { namePrefix, provider } from "./config";

export function createIrsaRole(options: {
	name: string;
	oidcProviderArn: pulumi.Input<string>;
	oidcProviderUrl: pulumi.Input<string>;
	namespace: string;
	serviceAccountName: string;
	policyArns: pulumi.Input<string>[];
}): aws.iam.Role {
	const { name, oidcProviderArn, oidcProviderUrl, namespace, serviceAccountName, policyArns } =
		options;

	const oidcUrl = pulumi
		.output(oidcProviderUrl)
		.apply((url: string) => url.replace("https://", ""));

	const assumeRolePolicy = aws.iam.getPolicyDocumentOutput(
		{
			statements: [
				{
					actions: ["sts:AssumeRoleWithWebIdentity"],
					effect: "Allow",
					principals: [{ type: "Federated", identifiers: [oidcProviderArn] }],
					conditions: [
						{
							test: "StringEquals",
							variable: pulumi.interpolate`${oidcUrl}:sub`,
							values: [`system:serviceaccount:${namespace}:${serviceAccountName}`],
						},
						{
							test: "StringEquals",
							variable: pulumi.interpolate`${oidcUrl}:aud`,
							values: ["sts.amazonaws.com"],
						},
					],
				},
			],
		},
		{ provider },
	);

	const role = new aws.iam.Role(
		name,
		{
			name: `${namePrefix}-${name}`,
			assumeRolePolicy: assumeRolePolicy.json,
		},
		{ provider },
	);

	policyArns.forEach((policyArn, index) => {
		new aws.iam.RolePolicyAttachment(
			`${name}-policy-${index + 1}`,
			{
				role: role.name,
				policyArn,
			},
			{ provider },
		);
	});

	return role;
}

export function createExternalSecretsPolicy(
	allowedSecretArns: pulumi.Input<pulumi.Input<string>[]>,
): aws.iam.Policy {
	const policy = new aws.iam.Policy(
		"external-secrets-policy",
		{
			name: `${namePrefix}-external-secrets`,
			policy: pulumi.output(allowedSecretArns).apply((arns: pulumi.Input<string>[]) =>
				JSON.stringify({
					Version: "2012-10-17",
					Statement: [
						{
							Effect: "Allow",
							Action: [
								"secretsmanager:GetSecretValue",
								"secretsmanager:DescribeSecret",
								"secretsmanager:ListSecretVersionIds",
							],
							Resource: arns,
						},
					],
				}),
			),
		},
		{ provider },
	);

	return policy;
}

export function createGatewayS3Policy(bucketArn: pulumi.Input<string>): aws.iam.Policy {
	return new aws.iam.Policy(
		"gateway-s3-policy",
		{
			name: `${namePrefix}-gateway-s3`,
			policy: pulumi.output(bucketArn).apply((arn: string) =>
				JSON.stringify({
					Version: "2012-10-17",
					Statement: [
						{
							Effect: "Allow",
							Action: ["s3:ListBucket"],
							Resource: arn,
						},
						{
							Effect: "Allow",
							Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
							Resource: `${arn}/*`,
						},
					],
				}),
			),
		},
		{ provider },
	);
}
