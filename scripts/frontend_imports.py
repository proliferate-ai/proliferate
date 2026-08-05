from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Token:
    kind: str
    value: str
    lineno: int
    start: int
    end: int


@dataclass(frozen=True)
class ImportStatement:
    source: str
    statement: str
    lineno: int
    type_only: bool


def _is_identifier_start(char: str) -> bool:
    return char.isalpha() or char in {"_", "$"}


def _is_identifier_part(char: str) -> bool:
    return char.isalnum() or char in {"_", "$"}


def tokenize_typescript(text: str) -> list[Token]:
    """Return the code tokens needed by the frontend boundary checks.

    Comments and template-literal contents are skipped. Quoted strings remain
    tokens so import specifiers can be read without treating arbitrary prose as
    code.
    """

    tokens: list[Token] = []
    index = 0
    lineno = 1
    length = len(text)

    while index < length:
        char = text[index]
        if char.isspace():
            if char == "\n":
                lineno += 1
            index += 1
            continue

        if char == "/" and index + 1 < length and text[index + 1] == "/":
            index += 2
            while index < length and text[index] != "\n":
                index += 1
            continue

        if char == "/" and index + 1 < length and text[index + 1] == "*":
            index += 2
            while index < length:
                if text[index] == "\n":
                    lineno += 1
                if index + 1 < length and text[index : index + 2] == "*/":
                    index += 2
                    break
                index += 1
            continue

        if char in {"'", '"'}:
            quote = char
            start = index
            start_line = lineno
            index += 1
            value: list[str] = []
            while index < length:
                current = text[index]
                if current == "\\" and index + 1 < length:
                    value.append(current)
                    value.append(text[index + 1])
                    if text[index + 1] == "\n":
                        lineno += 1
                    index += 2
                    continue
                if current == quote:
                    index += 1
                    break
                if current == "\n":
                    lineno += 1
                value.append(current)
                index += 1
            tokens.append(Token("string", "".join(value), start_line, start, index))
            continue

        if char == "`":
            # Imports are required to use static quoted specifiers. Skipping the
            # full template keeps fixture prose and display paths non-code.
            index += 1
            while index < length:
                current = text[index]
                if current == "\\" and index + 1 < length:
                    if text[index + 1] == "\n":
                        lineno += 1
                    index += 2
                    continue
                if current == "`":
                    index += 1
                    break
                if current == "\n":
                    lineno += 1
                index += 1
            continue

        if _is_identifier_start(char):
            start = index
            start_line = lineno
            index += 1
            while index < length and _is_identifier_part(text[index]):
                index += 1
            tokens.append(Token("identifier", text[start:index], start_line, start, index))
            continue

        tokens.append(Token("punctuation", char, lineno, index, index + 1))
        index += 1

    return tokens


def _statement_end(text: str, tokens: list[Token], source_index: int) -> int:
    for token in tokens[source_index + 1 :]:
        if token.value == ";":
            return token.end
        if token.lineno > tokens[source_index].lineno and token.value in {"import", "export"}:
            break
    return tokens[source_index].end


def _all_named_bindings_are_types(tokens: list[Token]) -> bool:
    try:
        open_index = next(index for index, token in enumerate(tokens) if token.value == "{")
        close_index = max(index for index, token in enumerate(tokens) if token.value == "}")
    except (StopIteration, ValueError):
        return False

    entries: list[list[Token]] = []
    current: list[Token] = []
    for token in tokens[open_index + 1 : close_index]:
        if token.value == ",":
            if current:
                entries.append(current)
            current = []
        else:
            current.append(token)
    if current:
        entries.append(current)
    return bool(entries) and all(entry[0].value == "type" for entry in entries)


def _is_type_only_tokens(tokens: list[Token], keyword: str) -> bool:
    if len(tokens) >= 2 and tokens[0].value == keyword and tokens[1].value == "type":
        return True
    return _all_named_bindings_are_types(tokens)


def collect_imports(path: Path, text: str) -> list[ImportStatement]:
    """Collect static imports, re-exports, and quoted dynamic imports."""

    del path  # Kept in the API because callers naturally have the source path.
    tokens = tokenize_typescript(text)
    imports: list[ImportStatement] = []
    index = 0

    while index < len(tokens):
        token = tokens[index]
        if token.kind != "identifier" or token.value not in {"import", "export"}:
            index += 1
            continue
        if index > 0 and tokens[index - 1].value == ".":
            index += 1
            continue

        keyword = token.value
        if keyword == "import" and index + 2 < len(tokens) and tokens[index + 1].value == "(":
            source_token = tokens[index + 2]
            if source_token.kind == "string":
                close_index = index + 3
                while close_index < len(tokens) and tokens[close_index].value != ")":
                    close_index += 1
                end = (
                    tokens[close_index].end
                    if close_index < len(tokens)
                    else source_token.end
                )
                imports.append(
                    ImportStatement(
                        source=source_token.value,
                        statement=text[token.start:end],
                        lineno=token.lineno,
                        type_only=False,
                    )
                )
                index = close_index + 1
                continue

        source_index: int | None = None
        if keyword == "import" and index + 1 < len(tokens) and tokens[index + 1].kind == "string":
            source_index = index + 1
        else:
            cursor = index + 1
            while cursor < len(tokens):
                current = tokens[cursor]
                if current.value == ";":
                    break
                if current.value == "from" and cursor + 1 < len(tokens):
                    candidate = tokens[cursor + 1]
                    if candidate.kind == "string":
                        source_index = cursor + 1
                    break
                cursor += 1

        if source_index is None:
            index += 1
            continue

        end = _statement_end(text, tokens, source_index)
        statement_tokens = tokens[index : source_index + 1]
        imports.append(
            ImportStatement(
                source=tokens[source_index].value,
                statement=text[token.start:end],
                lineno=token.lineno,
                type_only=_is_type_only_tokens(statement_tokens, keyword),
            )
        )
        index = source_index + 1

    return imports


def is_type_only_import(statement: str) -> bool:
    tokens = tokenize_typescript(statement)
    if not tokens or tokens[0].value not in {"import", "export"}:
        return False
    return _is_type_only_tokens(tokens, tokens[0].value)
