from proliferate.server.cloud.integrations.domain.tool_names import integration_tool_display_name


def test_integration_tool_display_name_formats_upstream_names() -> None:
    assert integration_tool_display_name("sentry", "find_projects") == "Find projects"
    assert integration_tool_display_name("github", "createIssue") == "Create issue"


def test_integration_tool_display_name_strips_provider_prefix() -> None:
    assert integration_tool_display_name("sentry", "sentry_find_projects") == "Find projects"


def test_integration_tool_display_name_preserves_common_acronyms() -> None:
    assert integration_tool_display_name("internal", "get_api_url") == "Get API URL"
