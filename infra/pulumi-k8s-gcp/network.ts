import * as gcp from "@pulumi/gcp";
import { namePrefix, networkName, podsCidr, region, servicesCidr, subnetCidr } from "./config";

export interface NetworkOutputs {
	network: gcp.compute.Network;
	subnet: gcp.compute.Subnetwork;
	router: gcp.compute.Router;
	nat: gcp.compute.RouterNat;
	peeringRange: gcp.compute.GlobalAddress;
	serviceNetworking: gcp.servicenetworking.Connection;
}

export function createNetwork(): NetworkOutputs {
	const network = new gcp.compute.Network("network", {
		name: networkName,
		autoCreateSubnetworks: false,
	});

	const subnet = new gcp.compute.Subnetwork("subnet", {
		name: `${namePrefix}-subnet`,
		region,
		network: network.id,
		ipCidrRange: subnetCidr,
		privateIpGoogleAccess: true,
		secondaryIpRanges: [
			{ rangeName: `${namePrefix}-pods`, ipCidrRange: podsCidr },
			{ rangeName: `${namePrefix}-services`, ipCidrRange: servicesCidr },
		],
	});

	const router = new gcp.compute.Router("router", {
		name: `${namePrefix}-router`,
		region,
		network: network.id,
	});

	const nat = new gcp.compute.RouterNat("nat", {
		name: `${namePrefix}-nat`,
		region,
		router: router.name,
		natIpAllocateOption: "AUTO_ONLY",
		sourceSubnetworkIpRangesToNat: "ALL_SUBNETWORKS_ALL_IP_RANGES",
		logConfig: { enable: true, filter: "ERRORS_ONLY" },
	});

	const peeringRange = new gcp.compute.GlobalAddress("services-range", {
		name: `${namePrefix}-services-range`,
		addressType: "INTERNAL",
		purpose: "VPC_PEERING",
		prefixLength: 16,
		network: network.id,
	});

	const serviceNetworking = new gcp.servicenetworking.Connection("services-conn", {
		network: network.id,
		service: "servicenetworking.googleapis.com",
		reservedPeeringRanges: [peeringRange.name],
	});

	return {
		network,
		subnet,
		router,
		nat,
		peeringRange,
		serviceNetworking,
	};
}
