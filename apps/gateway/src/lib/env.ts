import { env } from "@proliferate/environment/server";

const SSE_READ_TIMEOUT_MS = 60_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

export interface GatewayEnv {
	port: number;
	apiUrl: string;
	gatewayUrl: string;
	serviceToken: string;
	gatewayJwtSecret: string;
	userSecretsEncryptionKey: string;
	anthropicApiKey: string;
	githubAppId?: string;
	githubAppPrivateKey?: string;
	nangoSecretKey?: string;
	nangoGithubIntegrationId?: string;
	sseReadTimeoutMs: number;
	heartbeatTimeoutMs: number;
	reconnectDelaysMs: number[];
	// S3 configuration for verification uploads (optional outside cloud)
	s3Bucket?: string;
	s3Region?: string;
	s3EndpointUrl?: string;
	s3AccessKey?: string;
	s3SecretKey?: string;
	redisUrl: string;
}

export function loadGatewayEnv(): GatewayEnv {
	return {
		port: env.GATEWAY_PORT,
		apiUrl: env.NEXT_PUBLIC_API_URL,
		gatewayUrl: env.NEXT_PUBLIC_GATEWAY_URL,
		serviceToken: env.SERVICE_TO_SERVICE_AUTH_TOKEN,
		gatewayJwtSecret: env.GATEWAY_JWT_SECRET,
		userSecretsEncryptionKey: env.USER_SECRETS_ENCRYPTION_KEY,
		anthropicApiKey: env.ANTHROPIC_API_KEY,
		githubAppId: env.GITHUB_APP_ID,
		githubAppPrivateKey: env.GITHUB_APP_PRIVATE_KEY,
		nangoSecretKey: env.NANGO_SECRET_KEY,
		nangoGithubIntegrationId: env.NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID,
		sseReadTimeoutMs: SSE_READ_TIMEOUT_MS,
		heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
		reconnectDelaysMs: RECONNECT_DELAYS_MS,
		// S3 configuration
		s3Bucket: env.S3_BUCKET || undefined,
		s3Region: env.S3_REGION || undefined,
		s3EndpointUrl: env.S3_ENDPOINT_URL,
		s3AccessKey: env.S3_ACCESS_KEY,
		s3SecretKey: env.S3_SECRET_KEY,
		redisUrl: env.REDIS_URL,
	};
}
