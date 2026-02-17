-- Rename remaining prebuild_id columns to configuration_id
ALTER TABLE "sessions" RENAME COLUMN "prebuild_id" TO "configuration_id";
ALTER TABLE "automations" RENAME COLUMN "default_prebuild_id" TO "default_configuration_id";
ALTER TABLE "secrets" RENAME COLUMN "prebuild_id" TO "configuration_id";

-- Rename indexes on sessions
ALTER INDEX "idx_sessions_prebuild" RENAME TO "idx_sessions_configuration";

-- Rename indexes on automations
ALTER INDEX "idx_automations_prebuild" RENAME TO "idx_automations_configuration";

-- Rename foreign key constraints
ALTER TABLE "sessions" RENAME CONSTRAINT "sessions_prebuild_id_fkey" TO "sessions_configuration_id_fkey";
ALTER TABLE "automations" RENAME CONSTRAINT "automations_default_prebuild_id_fkey" TO "automations_default_configuration_id_fkey";
ALTER TABLE "secrets" RENAME CONSTRAINT "secrets_prebuild_id_fkey" TO "secrets_configuration_id_fkey";

-- Rename legacy constraint names on configurations table (from prebuild era)
ALTER INDEX "idx_prebuilds_sandbox_provider" RENAME TO "idx_configurations_sandbox_provider";
ALTER INDEX "idx_prebuilds_type_managed" RENAME TO "idx_configurations_type_managed";
ALTER TABLE "configurations" RENAME CONSTRAINT "prebuilds_created_by_fkey" TO "configurations_created_by_fkey";
ALTER TABLE "configurations" RENAME CONSTRAINT "prebuilds_user_id_fkey" TO "configurations_user_id_fkey";
ALTER TABLE "configurations" RENAME CONSTRAINT "prebuilds_user_path_unique" TO "configurations_user_path_unique";
ALTER TABLE "configurations" RENAME CONSTRAINT "prebuilds_sandbox_provider_check" TO "configurations_sandbox_provider_check";
ALTER TABLE "configurations" RENAME CONSTRAINT "prebuilds_cli_requires_path" TO "configurations_cli_requires_path";

-- Rename legacy constraint names on configuration_repos table
ALTER INDEX "idx_prebuild_repos_prebuild" RENAME TO "idx_configuration_repos_configuration";
ALTER INDEX "idx_prebuild_repos_repo" RENAME TO "idx_configuration_repos_repo";
ALTER TABLE "configuration_repos" RENAME CONSTRAINT "prebuild_repos_prebuild_id_fkey" TO "configuration_repos_configuration_id_fkey";
ALTER TABLE "configuration_repos" RENAME CONSTRAINT "prebuild_repos_repo_id_fkey" TO "configuration_repos_repo_id_fkey";
ALTER TABLE "configuration_repos" RENAME CONSTRAINT "prebuild_repos_pkey" TO "configuration_repos_pkey";

-- Rename secrets unique constraint
ALTER TABLE "secrets" RENAME CONSTRAINT "secrets_org_repo_prebuild_key_unique" TO "secrets_org_repo_configuration_key_unique";
