import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { availabilityZoneCount, clusterName, namePrefix, provider, vpcCidr } from "./config";

export interface NetworkOutputs {
	vpc: aws.ec2.Vpc;
	publicSubnets: aws.ec2.Subnet[];
	privateSubnets: aws.ec2.Subnet[];
}

function subnetTags(role: "public" | "private"): Record<string, string> {
	const tags: Record<string, string> = {
		Name: `${namePrefix}-${role}`,
		[`kubernetes.io/cluster/${clusterName}`]: "owned",
	};

	if (role === "public") {
		tags["kubernetes.io/role/elb"] = "1";
	} else {
		tags["kubernetes.io/role/internal-elb"] = "1";
	}

	return tags;
}

export function createNetwork(): NetworkOutputs {
	const availabilityZones = aws.getAvailabilityZones({ state: "available" }, { provider });

	const vpc = new aws.ec2.Vpc(
		"main",
		{
			cidrBlock: vpcCidr,
			enableDnsHostnames: true,
			enableDnsSupport: true,
			tags: { Name: `${namePrefix}-vpc` },
		},
		{ provider },
	);

	const publicSubnets: aws.ec2.Subnet[] = [];
	const privateSubnets: aws.ec2.Subnet[] = [];

	for (let index = 0; index < availabilityZoneCount; index += 1) {
		publicSubnets.push(
			new aws.ec2.Subnet(
				`public-${index + 1}`,
				{
					vpcId: vpc.id,
					cidrBlock: `10.0.${index + 101}.0/24`,
					availabilityZone: availabilityZones.then((zones: any) => zones.names[index]),
					mapPublicIpOnLaunch: true,
					tags: subnetTags("public"),
				},
				{ provider },
			),
		);

		privateSubnets.push(
			new aws.ec2.Subnet(
				`private-${index + 1}`,
				{
					vpcId: vpc.id,
					cidrBlock: `10.0.${index + 1}.0/24`,
					availabilityZone: availabilityZones.then((zones: any) => zones.names[index]),
					tags: subnetTags("private"),
				},
				{ provider },
			),
		);
	}

	const internetGateway = new aws.ec2.InternetGateway(
		"main",
		{ vpcId: vpc.id, tags: { Name: `${namePrefix}-igw` } },
		{ provider },
	);

	const natEip = new aws.ec2.Eip(
		"nat",
		{ domain: "vpc", tags: { Name: `${namePrefix}-nat-eip` } },
		{ provider },
	);

	const natGateway = new aws.ec2.NatGateway(
		"main",
		{
			allocationId: natEip.id,
			subnetId: publicSubnets[0].id,
			tags: { Name: `${namePrefix}-nat` },
		},
		{ provider, dependsOn: [internetGateway] },
	);

	const publicRouteTable = new aws.ec2.RouteTable(
		"public",
		{
			vpcId: vpc.id,
			routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: internetGateway.id }],
			tags: { Name: `${namePrefix}-public-rt` },
		},
		{ provider },
	);

	const privateRouteTable = new aws.ec2.RouteTable(
		"private",
		{
			vpcId: vpc.id,
			routes: [{ cidrBlock: "0.0.0.0/0", natGatewayId: natGateway.id }],
			tags: { Name: `${namePrefix}-private-rt` },
		},
		{ provider },
	);

	publicSubnets.forEach((subnet, index) => {
		new aws.ec2.RouteTableAssociation(
			`public-association-${index + 1}`,
			{ subnetId: subnet.id, routeTableId: publicRouteTable.id },
			{ provider },
		);
	});

	privateSubnets.forEach((subnet, index) => {
		new aws.ec2.RouteTableAssociation(
			`private-association-${index + 1}`,
			{ subnetId: subnet.id, routeTableId: privateRouteTable.id },
			{ provider },
		);
	});

	return { vpc, publicSubnets, privateSubnets };
}
