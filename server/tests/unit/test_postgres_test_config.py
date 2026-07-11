"""Regression coverage for the server test database connection override."""

from sqlalchemy import make_url

from tests.postgres import BASE_DATABASE_URL, make_database_url


def test_make_database_url_preserves_the_configured_server() -> None:
    database_name = "proliferate_test_override_probe"

    assert make_url(make_database_url(database_name)) == BASE_DATABASE_URL.set(
        database=database_name,
    )
