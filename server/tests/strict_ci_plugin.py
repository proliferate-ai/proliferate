"""Fail a deterministic CI pytest run on skips, xfails, or xpasses."""

from __future__ import annotations

import pytest
from _pytest.main import Session
from _pytest.terminal import TerminalReporter


def pytest_sessionfinish(session: Session, exitstatus: int) -> None:
    reporter: TerminalReporter | None = session.config.pluginmanager.get_plugin("terminalreporter")
    if reporter is None:
        return

    non_green = {
        report.nodeid
        for outcome in ("skipped", "xfailed", "xpassed")
        for report in reporter.stats.get(outcome, [])
    }
    if not non_green:
        return

    reporter.write_sep("=", "strict CI rejected non-green test outcomes", red=True)
    for nodeid in sorted(non_green):
        reporter.write_line(nodeid, red=True)
    session.exitstatus = pytest.ExitCode.TESTS_FAILED
