CREATE TABLE execution_store_identity (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    execution_store_id TEXT NOT NULL UNIQUE
);
