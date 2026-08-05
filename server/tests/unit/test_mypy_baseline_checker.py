from __future__ import annotations

from collections import Counter
import importlib.util
import json
from pathlib import Path
import sys

import pytest


def _load_checker_module():
    script_path = Path(__file__).resolve().parents[2] / "scripts" / "check_mypy_baseline.py"
    spec = importlib.util.spec_from_file_location("check_mypy_baseline", script_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_json_parser_normalizes_message_and_counts_duplicates() -> None:
    module = _load_checker_module()
    line = json.dumps(
        {
            "file": "proliferate/example.py",
            "line": 10,
            "column": 4,
            "message": "Incompatible   return\nvalue",
            "code": "return-value",
            "severity": "error",
        }
    )

    diagnostics = module.parse_mypy_json_lines(f"{line}\n{line}\n")

    identity = module.DiagnosticIdentity(
        path="proliferate/example.py",
        code="return-value",
        message="Incompatible return value",
    )
    assert diagnostics == Counter({identity: 2})


def test_json_parser_rejects_malformed_diagnostic() -> None:
    module = _load_checker_module()

    with pytest.raises(module.BaselineError, match="lacks string file/code/message"):
        module.parse_mypy_json_lines('{"severity": "error", "file": "example.py"}')


def test_json_parser_rejects_broken_json_object() -> None:
    module = _load_checker_module()

    with pytest.raises(module.BaselineError, match="malformed JSON"):
        module.parse_mypy_json_lines("{not-json")


def test_json_parser_rejects_non_json_output() -> None:
    module = _load_checker_module()

    with pytest.raises(module.BaselineError, match="unexpected non-JSON output"):
        module.parse_mypy_json_lines("pyproject.toml: error: Unrecognized option")


def test_comparison_reports_new_and_stale_multiplicity() -> None:
    module = _load_checker_module()
    shared = module.DiagnosticIdentity("proliferate/shared.py", "misc", "shared")
    added = module.DiagnosticIdentity("proliferate/new.py", "arg-type", "new")
    removed = module.DiagnosticIdentity("proliferate/old.py", "name-defined", "old")
    current = Counter({shared: 2, added: 1})
    expected = Counter({shared: 1, removed: 2})

    new, stale = module.compare_censuses(current, expected)

    assert new == Counter({shared: 1, added: 1})
    assert stale == Counter({removed: 2})


def test_baseline_writer_round_trips_multiplicity(tmp_path: Path) -> None:
    module = _load_checker_module()
    identity = module.DiagnosticIdentity("proliferate/example.py", "misc", "example")
    path = tmp_path / "baseline.json"

    module.write_baseline(
        path,
        module.Baseline(mypy_version="1.20.2", diagnostics=Counter({identity: 3})),
    )

    assert module.load_baseline(path) == module.Baseline(
        mypy_version="1.20.2",
        diagnostics=Counter({identity: 3}),
    )


def test_baseline_loader_rejects_duplicate_identity(tmp_path: Path) -> None:
    module = _load_checker_module()
    entry = {
        "path": "proliferate/example.py",
        "code": "misc",
        "message": "example",
        "count": 1,
    }
    path = tmp_path / "baseline.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "mypy_version": "1.20.2",
                "diagnostics": [entry, entry],
            }
        )
    )

    with pytest.raises(module.BaselineError, match="duplicate diagnostic identity"):
        module.load_baseline(path)


def test_baseline_update_refuses_growth() -> None:
    module = _load_checker_module()
    existing = module.DiagnosticIdentity("proliferate/old.py", "misc", "old")
    added = module.DiagnosticIdentity("proliferate/new.py", "misc", "new")

    with pytest.raises(module.BaselineError, match="refusing to grow"):
        module.require_no_growth(Counter({existing: 1, added: 1}), Counter({existing: 1}))


def test_monotonic_baseline_rejects_added_identity() -> None:
    module = _load_checker_module()
    existing = module.DiagnosticIdentity("proliferate/old.py", "misc", "old")
    added = module.DiagnosticIdentity("proliferate/new.py", "misc", "new")
    previous = module.Baseline("1.20.2", Counter({existing: 1}))
    candidate = module.Baseline("1.20.2", Counter({existing: 1, added: 1}))

    with pytest.raises(module.BaselineError, match="checked-in mypy baseline"):
        module.require_monotonic_baseline(candidate, previous)


def test_monotonic_baseline_rejects_replaced_identity() -> None:
    module = _load_checker_module()
    removed = module.DiagnosticIdentity("proliferate/example.py", "misc", "old")
    replacement = module.DiagnosticIdentity("proliferate/example.py", "misc", "replacement")
    previous = module.Baseline("1.20.2", Counter({removed: 1}))
    candidate = module.Baseline("1.20.2", Counter({replacement: 1}))

    with pytest.raises(module.BaselineError, match="replacement"):
        module.require_monotonic_baseline(candidate, previous)


def test_monotonic_baseline_rejects_count_growth() -> None:
    module = _load_checker_module()
    identity = module.DiagnosticIdentity("proliferate/example.py", "misc", "same")
    previous = module.Baseline("1.20.2", Counter({identity: 1}))
    candidate = module.Baseline("1.20.2", Counter({identity: 2}))

    with pytest.raises(module.BaselineError, match="same"):
        module.require_monotonic_baseline(candidate, previous)


def test_run_mypy_rejects_stderr_mixed_with_diagnostics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _load_checker_module()
    output = json.dumps(
        {
            "file": "proliferate/example.py",
            "message": "example",
            "code": "misc",
            "severity": "error",
        }
    )
    completed = module.subprocess.CompletedProcess(
        args=["mypy"],
        returncode=1,
        stdout=output,
        stderr="pyproject.toml: error: Unrecognized option\n",
    )
    monkeypatch.setattr(module.subprocess, "run", lambda *args, **kwargs: completed)

    with pytest.raises(module.BaselineError, match="unexpected stderr"):
        module.run_mypy("mypy")


def test_mypy_version_parser_rejects_unrecognized_output(monkeypatch: pytest.MonkeyPatch) -> None:
    module = _load_checker_module()
    completed = module.subprocess.CompletedProcess(
        args=["mypy", "--version"],
        returncode=0,
        stdout="unexpected\n",
        stderr="",
    )
    monkeypatch.setattr(module.subprocess, "run", lambda *args, **kwargs: completed)

    with pytest.raises(module.BaselineError, match="unrecognized mypy version"):
        module.read_mypy_version("mypy")
