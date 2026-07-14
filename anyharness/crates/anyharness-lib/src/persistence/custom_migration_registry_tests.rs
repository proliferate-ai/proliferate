use super::custom_migrations::CUSTOM_MIGRATIONS;

#[test]
fn custom_migrations_register_review_auto_iterate_rename() {
    assert!(CUSTOM_MIGRATIONS
        .iter()
        .any(|(name, _)| *name == "0036_rename_review_auto_iterate"));
}
