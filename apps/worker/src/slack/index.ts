/**
 * Slack client module
 */

// Main client
export { SlackClient, type SlackClientMetadata } from "./client";

// Utilities
export { postToSlack, formatToolMessage, shouldPostTool } from "./lib";

// Slack API client
export { SlackApiClient, type SlackBlock, type PostMessageOptions } from "./api";
