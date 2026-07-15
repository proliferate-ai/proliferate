mod custom_migration_schema;
mod custom_migrations;
pub mod migrations;
pub mod sqlite;
mod workflow_runs_v2_migration;

#[cfg(test)]
mod custom_migration_registry_tests;
#[cfg(test)]
mod schema_snapshot_tests;
#[cfg(test)]
mod workflow_runs_v2_migration_tests;

pub use sqlite::Db;
