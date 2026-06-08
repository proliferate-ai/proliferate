use std::path::PathBuf;

use rusqlite::Connection;

use super::migrations::run_migrations;

fn migrated_connection() -> rusqlite::Result<Connection> {
    let mut conn = Connection::open_in_memory()?;
    run_migrations(&mut conn)?;
    Ok(conn)
}

fn dump_schema(conn: &Connection) -> rusqlite::Result<String> {
    let mut stmt = conn.prepare(
        "SELECT type, name, sql
         FROM sqlite_schema
         WHERE sql IS NOT NULL
           AND name NOT LIKE 'sqlite_%'
         ORDER BY
           CASE type
             WHEN 'table' THEN 0
             WHEN 'index' THEN 1
             WHEN 'trigger' THEN 2
             WHEN 'view' THEN 3
             ELSE 4
           END,
           name",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>("type")?,
            row.get::<_, String>("name")?,
            row.get::<_, String>("sql")?,
        ))
    })?;

    let mut schema = String::new();
    for row in rows {
        let (object_type, name, sql) = row?;
        schema.push_str(&format!("-- {object_type}: {name}\n"));
        schema.push_str(sql.trim());
        schema.push_str(";\n\n");
    }
    if schema.ends_with("\n\n") {
        schema.pop();
    }
    Ok(schema)
}

fn schema_snapshot_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../specs/generated/anyharness-db-schema.sql")
}

fn assert_schema_snapshot_matches(actual: &str, expected: &str) {
    if actual == expected {
        return;
    }

    let actual_lines: Vec<&str> = actual.lines().collect();
    let expected_lines: Vec<&str> = expected.lines().collect();
    for (index, (actual_line, expected_line)) in
        actual_lines.iter().zip(expected_lines.iter()).enumerate()
    {
        if actual_line != expected_line {
            panic!(
                "schema snapshot mismatch at line {}:\n  actual:   {actual_line}\n  expected: {expected_line}\n\
                 Run `cargo test -p anyharness-lib update_anyharness_schema_snapshot -- --ignored` to regenerate.",
                index + 1
            );
        }
    }

    panic!(
        "schema snapshot line count differs: actual {} vs expected {} lines.\n\
         Run `cargo test -p anyharness-lib update_anyharness_schema_snapshot -- --ignored` to regenerate.",
        actual_lines.len(),
        expected_lines.len()
    );
}

#[test]
fn anyharness_schema_snapshot_matches_migrations() {
    let conn = migrated_connection().expect("migrated db");
    let actual = dump_schema(&conn).expect("dump schema");
    let expected_path = schema_snapshot_path();
    let expected = std::fs::read_to_string(&expected_path).unwrap_or_else(|error| {
        panic!(
            "failed to read schema snapshot at {}: {error}",
            expected_path.display()
        )
    });

    assert_schema_snapshot_matches(&actual, &expected);
}

#[test]
#[ignore]
fn update_anyharness_schema_snapshot() {
    let conn = migrated_connection().expect("migrated db");
    let schema = dump_schema(&conn).expect("dump schema");
    let path = schema_snapshot_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create snapshot directory");
    }
    std::fs::write(path, schema).expect("write schema snapshot");
}
