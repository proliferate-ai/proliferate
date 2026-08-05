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


def _decode_javascript_string(raw: str) -> str:
    """Cook a JavaScript string without changing its source span."""

    simple_escapes = {
        "b": "\b",
        "f": "\f",
        "n": "\n",
        "r": "\r",
        "t": "\t",
        "v": "\v",
        "0": "\0",
    }
    cooked: list[str] = []
    index = 0
    while index < len(raw):
        if raw[index] != "\\" or index + 1 >= len(raw):
            cooked.append(raw[index])
            index += 1
            continue

        escaped = raw[index + 1]
        if escaped == "\n":
            index += 2
            continue
        if escaped == "\r":
            index += 3 if index + 2 < len(raw) and raw[index + 2] == "\n" else 2
            continue
        if escaped == "x" and index + 3 < len(raw):
            digits = raw[index + 2 : index + 4]
            if all(char in "0123456789abcdefABCDEF" for char in digits):
                cooked.append(chr(int(digits, 16)))
                index += 4
                continue
        if escaped == "u":
            if index + 2 < len(raw) and raw[index + 2] == "{":
                close = raw.find("}", index + 3)
                digits = raw[index + 3 : close] if close >= 0 else ""
                if digits and all(char in "0123456789abcdefABCDEF" for char in digits):
                    value = int(digits, 16)
                    if value <= 0x10FFFF:
                        cooked.append(chr(value))
                        index = close + 1
                        continue
            elif index + 5 < len(raw):
                digits = raw[index + 2 : index + 6]
                if all(char in "0123456789abcdefABCDEF" for char in digits):
                    cooked.append(chr(int(digits, 16)))
                    index += 6
                    continue

        cooked.append(simple_escapes.get(escaped, escaped))
        index += 2
    return "".join(cooked)


class _TypeScriptLexer:
    def __init__(self, text: str) -> None:
        self.text = text
        self.length = len(text)
        self.tokens: list[Token] = []

    def scan(self) -> list[Token]:
        self._scan_code(0, 1, stop_on_closing_brace=False)
        return self.tokens

    def _scan_quoted(self, index: int, lineno: int) -> tuple[str, int, int]:
        quote = self.text[index]
        index += 1
        raw: list[str] = []
        while index < self.length:
            current = self.text[index]
            if current == "\\" and index + 1 < self.length:
                raw.extend((current, self.text[index + 1]))
                if self.text[index + 1] == "\n":
                    lineno += 1
                elif self.text[index + 1] == "\r":
                    if index + 2 < self.length and self.text[index + 2] == "\n":
                        raw.append("\n")
                        index += 1
                    lineno += 1
                index += 2
                continue
            if current == quote:
                return "".join(raw), index + 1, lineno
            if current == "\n":
                lineno += 1
            raw.append(current)
            index += 1
        return "".join(raw), index, lineno

    def _expression_can_start(self, segment_token_start: int) -> bool:
        if len(self.tokens) == segment_token_start:
            return True
        previous = self.tokens[-1].value
        if previous in {
            "(",
            "[",
            "{",
            ",",
            ";",
            ":",
            "=",
            "!",
            "?",
            "~",
            "+",
            "-",
            "*",
            "%",
            "&",
            "|",
            "^",
            "return",
            "throw",
            "case",
            "delete",
            "void",
            "yield",
            "await",
        }:
            return True
        return (
            len(self.tokens) >= 2
            and self.tokens[-2].value == "="
            and previous == ">"
        )

    def _scan_regex(self, index: int, lineno: int) -> tuple[int, int]:
        index += 1
        in_character_class = False
        while index < self.length:
            current = self.text[index]
            if current == "\\" and index + 1 < self.length:
                index += 2
                continue
            if current == "\n":
                return index, lineno
            if current == "[":
                in_character_class = True
            elif current == "]":
                in_character_class = False
            elif current == "/" and not in_character_class:
                index += 1
                while index < self.length and self.text[index].isalpha():
                    index += 1
                return index, lineno
            index += 1
        return index, lineno

    def _jsx_tag_end(self, index: int) -> int | None:
        cursor = index + 1
        brace_depth = 0
        quote: str | None = None
        while cursor < self.length:
            current = self.text[cursor]
            if quote is not None:
                if current == "\\" and cursor + 1 < self.length:
                    cursor += 2
                    continue
                if current == quote:
                    quote = None
                cursor += 1
                continue
            if current in {"'", '"'}:
                quote = current
            elif current == "{":
                brace_depth += 1
            elif current == "}" and brace_depth:
                brace_depth -= 1
            elif current == ">" and not brace_depth:
                return cursor
            cursor += 1
        return None

    def _looks_like_jsx(self, index: int, segment_token_start: int) -> bool:
        if not self._expression_can_start(segment_token_start) or index + 1 >= self.length:
            return False
        next_char = self.text[index + 1]
        if next_char == ">":
            return True
        if not _is_identifier_start(next_char):
            return False

        cursor = index + 2
        while cursor < self.length and (
            _is_identifier_part(self.text[cursor]) or self.text[cursor] in {".", ":", "-"}
        ):
            cursor += 1
        tag_name = self.text[index + 1 : cursor]
        tag_end = self._jsx_tag_end(index)
        if tag_end is None:
            return False
        after = tag_end + 1
        while after < self.length and self.text[after].isspace():
            after += 1
        if after < self.length and self.text[after] == "(":
            return False
        if self.text[index:tag_end].rstrip().endswith("/"):
            return True
        if tag_name[0].islower() or any(char in tag_name for char in ".:-"):
            return True
        if f"</{tag_name}" in self.text[tag_end + 1 :]:
            return True
        return bool(self.text[cursor:tag_end].strip())

    def _scan_jsx_tag(
        self, index: int, lineno: int
    ) -> tuple[int, int, bool, bool]:
        closing = self.text.startswith("</", index)
        cursor = index + (2 if closing else 1)
        last_nonspace = ""
        while cursor < self.length:
            current = self.text[cursor]
            if current in {"'", '"'}:
                _, cursor, lineno = self._scan_quoted(cursor, lineno)
                last_nonspace = "quoted"
                continue
            if current == "{" and not closing:
                cursor, lineno = self._scan_code(
                    cursor + 1, lineno, stop_on_closing_brace=True
                )
                last_nonspace = "expression"
                continue
            if current == ">":
                return cursor + 1, lineno, closing, last_nonspace == "/"
            if current == "\n":
                lineno += 1
            if not current.isspace():
                last_nonspace = current
            cursor += 1
        return cursor, lineno, closing, False

    def _scan_jsx(self, index: int, lineno: int) -> tuple[int, int]:
        index, lineno, closing, self_closing = self._scan_jsx_tag(index, lineno)
        if closing or self_closing:
            return index, lineno
        depth = 1
        while index < self.length and depth:
            current = self.text[index]
            if current == "{":
                index, lineno = self._scan_code(
                    index + 1, lineno, stop_on_closing_brace=True
                )
                continue
            if current == "<" and index + 1 < self.length and (
                self.text[index + 1] in {"/", ">"}
                or _is_identifier_start(self.text[index + 1])
            ):
                index, lineno, closing, self_closing = self._scan_jsx_tag(index, lineno)
                if closing:
                    depth -= 1
                elif not self_closing:
                    depth += 1
                continue
            if current == "\n":
                lineno += 1
            index += 1
        return index, lineno

    def _scan_template(self, index: int, lineno: int) -> tuple[int, int]:
        start = index
        start_line = lineno
        index += 1
        raw: list[str] = []
        interpolated = False
        while index < self.length:
            current = self.text[index]
            if current == "\\" and index + 1 < self.length:
                raw.extend((current, self.text[index + 1]))
                if self.text[index + 1] == "\n":
                    lineno += 1
                index += 2
                continue
            if current == "`":
                index += 1
                if not interpolated:
                    self.tokens.append(
                        Token(
                            "string",
                            _decode_javascript_string("".join(raw)),
                            start_line,
                            start,
                            index,
                        )
                    )
                return index, lineno
            if current == "$" and index + 1 < self.length and self.text[index + 1] == "{":
                interpolated = True
                index, lineno = self._scan_code(
                    index + 2, lineno, stop_on_closing_brace=True
                )
                continue
            if current == "\n":
                lineno += 1
            raw.append(current)
            index += 1
        return index, lineno

    def _scan_code(
        self, index: int, lineno: int, *, stop_on_closing_brace: bool
    ) -> tuple[int, int]:
        brace_depth = 0
        segment_token_start = len(self.tokens)
        while index < self.length:
            char = self.text[index]
            if char.isspace():
                if char == "\n":
                    lineno += 1
                index += 1
                continue

            if char == "/" and index + 1 < self.length and self.text[index + 1] == "/":
                index += 2
                while index < self.length and self.text[index] != "\n":
                    index += 1
                continue
            if char == "/" and index + 1 < self.length and self.text[index + 1] == "*":
                index += 2
                while index < self.length:
                    if self.text[index] == "\n":
                        lineno += 1
                    if index + 1 < self.length and self.text[index : index + 2] == "*/":
                        index += 2
                        break
                    index += 1
                continue

            if char in {"'", '"'}:
                start = index
                start_line = lineno
                raw, index, lineno = self._scan_quoted(index, lineno)
                self.tokens.append(
                    Token(
                        "string",
                        _decode_javascript_string(raw),
                        start_line,
                        start,
                        index,
                    )
                )
                continue
            if char == "`":
                index, lineno = self._scan_template(index, lineno)
                continue
            if char == "/" and self._expression_can_start(segment_token_start):
                index, lineno = self._scan_regex(index, lineno)
                continue
            if char == "<" and self._looks_like_jsx(index, segment_token_start):
                index, lineno = self._scan_jsx(index, lineno)
                continue

            if _is_identifier_start(char):
                start = index
                start_line = lineno
                index += 1
                while index < self.length and _is_identifier_part(self.text[index]):
                    index += 1
                self.tokens.append(
                    Token("identifier", self.text[start:index], start_line, start, index)
                )
                continue

            if char == "{" and stop_on_closing_brace:
                brace_depth += 1
            elif char == "}" and stop_on_closing_brace:
                if brace_depth == 0:
                    return index + 1, lineno
                brace_depth -= 1
            self.tokens.append(Token("punctuation", char, lineno, index, index + 1))
            index += 1
        return index, lineno


def tokenize_typescript(text: str) -> list[Token]:
    """Return executable TypeScript tokens plus cooked string literals.

    Comments, regular-expression bodies, JSX display text, and template prose
    are skipped. Executable JSX and template interpolations are scanned.
    """

    return _TypeScriptLexer(text).scan()


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

    # A default or namespace binding makes the statement a runtime import even
    # when every binding inside the named clause uses a `type` modifier.
    if tokens[1:open_index]:
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
    return bool(entries) and all(
        len(entry) >= 2
        and entry[0].value == "type"
        and entry[1].value != "as"
        for entry in entries
    )


def _is_type_only_tokens(tokens: list[Token], keyword: str) -> bool:
    if (
        len(tokens) >= 3
        and tokens[0].value == keyword
        and tokens[1].value == "type"
        and tokens[2].value != "from"
    ):
        return True
    return _all_named_bindings_are_types(tokens)


def _is_import_type_expression(tokens: list[Token], import_index: int) -> bool:
    """Recognize a dynamic-import-shaped node in a definite type alias."""

    statement_start = import_index
    while statement_start > 0 and tokens[statement_start - 1].value != ";":
        statement_start -= 1
    prefix = tokens[statement_start:import_index]
    while prefix and prefix[0].value in {"declare", "export"}:
        prefix = prefix[1:]
    if not prefix or prefix[0].value != "type":
        return False
    try:
        equals_index = next(index for index, token in enumerate(prefix) if token.value == "=")
    except StopIteration:
        return False
    return not any(
        token.value in {"class", "const", "enum", "function", "interface", "let", "var"}
        for token in prefix[equals_index + 1 :]
    )


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
                        type_only=_is_import_type_expression(tokens, index),
                    )
                )
                index = close_index + 1
                continue
            # The module source is computed, so there is no stable target to
            # report. Continue walking its executable expression so a nested
            # literal import is still discovered independently.
            index += 1
            continue

        # `import.meta` is an expression, and declaration exports (`export
        # const`, `export function`, and friends) cannot contain a re-export
        # source. Restrict the static-source search to actual grammar prefixes
        # so a later function call named `from(...)` cannot become an import.
        if keyword == "import" and index + 1 < len(tokens) and tokens[index + 1].value == ".":
            index += 1
            continue
        if keyword == "export":
            export_clause = index + 1
            if export_clause < len(tokens) and tokens[export_clause].value == "type":
                export_clause += 1
            if (
                export_clause >= len(tokens)
                or tokens[export_clause].value not in {"{", "*"}
            ):
                index += 1
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
