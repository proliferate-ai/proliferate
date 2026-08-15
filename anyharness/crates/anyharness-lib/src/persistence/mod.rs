mod custom_migration_schema;
mod custom_migrations;
pub mod migrations;
pub mod sqlite;
mod workflow_run_control_migration;
mod workflow_runs_v2_migration;

#[cfg(test)]
mod custom_migration_registry_tests;
#[cfg(test)]
mod schema_snapshot_tests;
#[cfg(test)]
mod workspace_archived_lifecycle_migration_tests;
#[cfg(test)]
mod workspace_archived_lifecycle_rebuild_tests;
#[cfg(test)]
mod workspace_drop_cleanup_columns_migration_tests;

pub use sqlite::Db;
