#!/usr/bin/env python3

"""Run strict mypy with an exact, shrink-only diagnostic census.

The server already enables strict mypy, but origin/main has existing type debt.
This checker makes that debt explicit without weakening mypy configuration:
new diagnostics fail, and removed diagnostics make the baseline stale until it
is ratcheted down with ``--write-baseline``.

Diagnostic identity intentionally excludes line numbers. It includes the
repository-relative file, error code, normalized message, and multiplicity, so
ordinary line movement is stable while a new diagnostic kind still fails.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

SERVER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVER_ROOT.parent
DEFAULT_BASELINE = Path(__file__).with_name("mypy_baseline.json")
SCHEMA_VERSION = 1
MYPY_ARGUMENTS = (
    "proliferate/",
    "--output",
    "json",
    "--no-error-summary",
    "--no-incremental",
)


class BaselineError(RuntimeError):
    """The checker cannot establish or compare a trustworthy census."""


@dataclass(frozen=True, order=True)
class DiagnosticIdentity:
    path: str
    code: str
    message: str

    def format(self, count: int) -> str:
        suffix = f" (x{count})" if count != 1 else ""
        return f"{self.path}: [{self.code}] {self.message}{suffix}"


@dataclass(frozen=True)
class Baseline:
    mypy_version: str
    diagnostics: Counter[DiagnosticIdentity]


def normalize_message(message: str) -> str:
    return " ".join(message.split())


def normalize_path(path: str) -> str:
    normalized = PurePosixPath(path.replace("\\", "/"))
    if normalized.is_absolute() or ".." in normalized.parts:
        raise BaselineError(f"mypy emitted a non-repository-relative path: {path!r}")
    value = normalized.as_posix()
    if not value or value == ".":
        raise BaselineError("mypy emitted an empty diagnostic path")
    return value


def parse_mypy_json_lines(output: str) -> Counter[DiagnosticIdentity]:
    diagnostics: Counter[DiagnosticIdentity] = Counter()
    for line_number, raw_line in enumerate(output.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        if not line.startswith("{"):
            raise BaselineError(
                f"mypy emitted unexpected non-JSON output on line {line_number}: {line!r}"
            )
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as error:
            raise BaselineError(
                f"mypy emitted malformed JSON on output line {line_number}: {error.msg}"
            ) from error
        if not isinstance(payload, dict):
            raise BaselineError(f"mypy JSON output line {line_number} is not an object")
        severity = payload.get("severity")
        if severity != "error":
            continue
        raw_path = payload.get("file")
        code = payload.get("code")
        message = payload.get("message")
        if (
            not isinstance(raw_path, str)
            or not isinstance(code, str)
            or not isinstance(message, str)
        ):
            raise BaselineError(
                f"mypy error output line {line_number} lacks string file/code/message fields"
            )
        identity = DiagnosticIdentity(
            path=normalize_path(raw_path),
            code=code.strip(),
            message=normalize_message(message),
        )
        if not identity.code or not identity.message:
            raise BaselineError(f"mypy error output line {line_number} has an empty code/message")
        diagnostics[identity] += 1
    return diagnostics


def _require_exact_keys(payload: dict[object, object], expected: set[str], label: str) -> None:
    actual = {key for key in payload if isinstance(key, str)}
    non_string = [key for key in payload if not isinstance(key, str)]
    if non_string or actual != expected:
        raise BaselineError(
            f"{label} keys must be exactly {sorted(expected)}; got {sorted(actual)}"
        )


def parse_baseline(text: str, *, label: str) -> Baseline:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        raise BaselineError(f"{label} is malformed JSON: {error}") from error
    if not isinstance(payload, dict):
        raise BaselineError(f"{label} root must be an object")
    _require_exact_keys(
        payload,
        {"schema_version", "mypy_version", "diagnostics"},
        label,
    )
    if payload["schema_version"] != SCHEMA_VERSION:
        raise BaselineError(f"unsupported mypy baseline schema: {payload['schema_version']!r}")
    mypy_version = payload["mypy_version"]
    entries = payload["diagnostics"]
    if not isinstance(mypy_version, str) or not mypy_version:
        raise BaselineError("mypy baseline version must be a non-empty string")
    if not isinstance(entries, list):
        raise BaselineError("mypy baseline diagnostics must be a list")

    diagnostics: Counter[DiagnosticIdentity] = Counter()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise BaselineError(f"mypy baseline diagnostic {index} must be an object")
        _require_exact_keys(entry, {"path", "code", "message", "count"}, f"diagnostic {index}")
        raw_path = entry["path"]
        code = entry["code"]
        message = entry["message"]
        count = entry["count"]
        if (
            not isinstance(raw_path, str)
            or not isinstance(code, str)
            or not isinstance(message, str)
        ):
            raise BaselineError(f"mypy baseline diagnostic {index} has invalid text fields")
        if not isinstance(count, int) or isinstance(count, bool) or count < 1:
            raise BaselineError(f"mypy baseline diagnostic {index} count must be positive")
        identity = DiagnosticIdentity(
            path=normalize_path(raw_path),
            code=code,
            message=normalize_message(message),
        )
        if identity in diagnostics:
            raise BaselineError(
                f"mypy baseline contains duplicate diagnostic identity: {identity.format(count)}"
            )
        diagnostics[identity] = count
    return Baseline(mypy_version=mypy_version, diagnostics=diagnostics)


def load_baseline(path: Path) -> Baseline:
    try:
        text = path.read_text()
    except FileNotFoundError as error:
        raise BaselineError(f"mypy baseline does not exist: {path}") from error
    return parse_baseline(text, label="mypy baseline")


def baseline_repo_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError as error:
        raise BaselineError(f"comparison baseline must live in the repository: {path}") from error


def load_baseline_from_git(ref: str, path: Path) -> Baseline | None:
    revision = f"{ref}^{{commit}}"
    resolved = subprocess.run(
        ["git", "rev-parse", "--verify", revision],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if resolved.returncode != 0:
        detail = (resolved.stderr or resolved.stdout).strip()
        raise BaselineError(f"could not resolve comparison ref {ref!r}: {detail}")

    relative_path = baseline_repo_path(path)
    listed = subprocess.run(
        ["git", "ls-tree", "--name-only", ref, "--", relative_path],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if listed.returncode != 0:
        detail = (listed.stderr or listed.stdout).strip()
        raise BaselineError(f"could not inspect comparison baseline at {ref!r}: {detail}")
    if listed.stdout.strip() != relative_path:
        return None
    object_name = f"{ref}:{relative_path}"
    shown = subprocess.run(
        ["git", "show", object_name],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if shown.returncode != 0:
        detail = (shown.stderr or shown.stdout).strip()
        raise BaselineError(f"could not read comparison baseline at {ref!r}: {detail}")
    return parse_baseline(shown.stdout, label=f"mypy baseline at {ref}")


def baseline_payload(baseline: Baseline) -> dict[str, object]:
    return {
        "schema_version": SCHEMA_VERSION,
        "mypy_version": baseline.mypy_version,
        "diagnostics": [
            {
                "path": identity.path,
                "code": identity.code,
                "message": identity.message,
                "count": count,
            }
            for identity, count in sorted(baseline.diagnostics.items())
        ],
    }


def write_baseline(path: Path, baseline: Baseline) -> None:
    path.write_text(json.dumps(baseline_payload(baseline), indent=2) + "\n")


def compare_censuses(
    current: Counter[DiagnosticIdentity],
    expected: Counter[DiagnosticIdentity],
) -> tuple[Counter[DiagnosticIdentity], Counter[DiagnosticIdentity]]:
    return current - expected, expected - current


def require_no_growth(
    current: Counter[DiagnosticIdentity],
    expected: Counter[DiagnosticIdentity],
    *,
    label: str = "mypy baseline",
) -> None:
    new_diagnostics, _ = compare_censuses(current, expected)
    if new_diagnostics:
        raise BaselineError(
            f"refusing to grow {label}; resolve these new diagnostics first:\n"
            + format_census(new_diagnostics)
        )


def require_monotonic_baseline(candidate: Baseline, previous: Baseline) -> None:
    if candidate.mypy_version != previous.mypy_version:
        raise BaselineError(
            "baseline mypy version changed; tool upgrades require a separately reviewed "
            f"re-baseline (previous {previous.mypy_version}, candidate {candidate.mypy_version})"
        )
    require_no_growth(
        candidate.diagnostics,
        previous.diagnostics,
        label="the checked-in mypy baseline",
    )


def format_census(census: Counter[DiagnosticIdentity]) -> str:
    return "\n".join(f"  {identity.format(count)}" for identity, count in sorted(census.items()))


def resolve_executable(value: str) -> str:
    if "/" not in value and "\\" not in value:
        return value
    return str(Path(value).expanduser().resolve())


def read_mypy_version(mypy_executable: str) -> str:
    result = subprocess.run(
        [mypy_executable, "--version"],
        cwd=SERVER_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise BaselineError(f"could not read mypy version: {detail or result.returncode}")
    match = re.match(r"^mypy\s+([0-9]+(?:\.[0-9]+)+)\b", result.stdout.strip())
    if match is None:
        raise BaselineError(f"unrecognized mypy version output: {result.stdout.strip()!r}")
    return match.group(1)


def run_mypy(mypy_executable: str) -> Counter[DiagnosticIdentity]:
    result = subprocess.run(
        [mypy_executable, *MYPY_ARGUMENTS],
        cwd=SERVER_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode not in {0, 1}:
        detail = (result.stderr or result.stdout).strip()
        raise BaselineError(f"mypy invocation failed ({result.returncode}): {detail}")
    if result.stderr.strip():
        raise BaselineError(f"mypy emitted unexpected stderr: {result.stderr.strip()}")
    diagnostics = parse_mypy_json_lines(result.stdout)
    if result.returncode == 1 and not diagnostics:
        detail = (result.stderr or result.stdout).strip()
        raise BaselineError(f"mypy failed without parseable error diagnostics: {detail}")
    if result.returncode == 0 and diagnostics:
        raise BaselineError("mypy returned success while emitting error diagnostics")
    return diagnostics


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mypy", default="mypy", help="mypy executable (default: %(default)s)")
    parser.add_argument(
        "--baseline",
        type=Path,
        default=DEFAULT_BASELINE,
        help="baseline JSON path (default: %(default)s)",
    )
    parser.add_argument(
        "--compare-ref",
        help="Git revision whose baseline is the shrink-only lower bound",
    )
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument(
        "--initialize-baseline",
        action="store_true",
        help="create the first baseline; refuses when the path already exists",
    )
    actions.add_argument(
        "--write-baseline",
        action="store_true",
        help="remove stale entries; refuses any diagnostic growth",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    baseline_path = args.baseline.resolve()
    mypy_executable = resolve_executable(args.mypy)
    try:
        mypy_version = read_mypy_version(mypy_executable)
        if args.initialize_baseline:
            if baseline_path.exists():
                raise BaselineError(f"refusing to replace existing baseline: {baseline_path}")
            current = run_mypy(mypy_executable)
            write_baseline(
                baseline_path,
                Baseline(mypy_version=mypy_version, diagnostics=current),
            )
            print(f"Initialized mypy baseline with {sum(current.values())} diagnostics.")
            return 0

        if not args.compare_ref:
            raise BaselineError("--compare-ref is required outside one-time initialization")

        baseline = load_baseline(baseline_path)
        previous_baseline = load_baseline_from_git(args.compare_ref, baseline_path)
        if previous_baseline is None:
            print(
                f"Comparison ref {args.compare_ref} has no mypy baseline; "
                "treating this as the one-time reviewed initialization."
            )
        else:
            require_monotonic_baseline(baseline, previous_baseline)
        if mypy_version != baseline.mypy_version:
            raise BaselineError(
                "mypy version does not match the reviewed baseline: "
                f"expected {baseline.mypy_version}, got {mypy_version}"
            )
        current = run_mypy(mypy_executable)
        new_diagnostics, stale_diagnostics = compare_censuses(
            current,
            baseline.diagnostics,
        )

        if args.write_baseline:
            require_no_growth(current, baseline.diagnostics)
            if previous_baseline is not None:
                require_no_growth(
                    current,
                    previous_baseline.diagnostics,
                    label="the comparison-ref mypy baseline",
                )
            if not stale_diagnostics:
                print(f"Mypy baseline is already exact ({sum(current.values())} diagnostics).")
                return 0
            write_baseline(
                baseline_path,
                Baseline(mypy_version=mypy_version, diagnostics=current),
            )
            print(
                "Shrank mypy baseline by "
                f"{sum(stale_diagnostics.values())} diagnostics; "
                f"{sum(current.values())} remain."
            )
            return 0

        failures: list[str] = []
        if new_diagnostics:
            failures.append("New mypy diagnostics:\n" + format_census(new_diagnostics))
        if stale_diagnostics:
            failures.append(
                "Stale mypy baseline entries (fixes must ratchet the census down):\n"
                + format_census(stale_diagnostics)
                + "\n  Run: python scripts/check_mypy_baseline.py --write-baseline"
            )
        if failures:
            raise BaselineError("\n\n".join(failures))
        print(f"Mypy diagnostic ratchet passed ({sum(current.values())} existing diagnostics).")
        return 0
    except (BaselineError, OSError) as error:
        print(f"Mypy diagnostic ratchet failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
