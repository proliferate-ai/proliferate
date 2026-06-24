from proliferate.rls_context import (
    get_rls_context,
    set_rls_actor_context,
    set_rls_owner_context,
    with_cleared_rls_context,
    with_rls_context,
)


def test_rls_context_can_be_scoped_and_restored() -> None:
    with with_cleared_rls_context():
        set_rls_actor_context("user-1")
        set_rls_owner_context(owner_scope="personal", organization_id=None)

        assert get_rls_context() == ("user-1", "personal", None)

        with with_rls_context(
            actor_user_id="user-2",
            owner_scope="organization",
            organization_id="org-1",
        ):
            assert get_rls_context() == ("user-2", "organization", "org-1")

        assert get_rls_context() == ("user-1", "personal", None)


def test_cleared_rls_context_restores_previous_values() -> None:
    with (
        with_cleared_rls_context(),
        with_rls_context(
            actor_user_id="user-1",
            owner_scope="organization",
            organization_id="org-1",
        ),
    ):
        assert get_rls_context() == ("user-1", "organization", "org-1")

        with with_cleared_rls_context():
            assert get_rls_context() == (None, None, None)

        assert get_rls_context() == ("user-1", "organization", "org-1")
