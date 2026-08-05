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
    imported_names: frozenset[str] = frozenset()
    local_bindings: frozenset[str] = frozenset()
    namespace_bindings: frozenset[str] = frozenset()
    start: int = -1


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
    def __init__(self, text: str, *, jsx: bool) -> None:
        self.text = text
        self.length = len(text)
        self.jsx = jsx
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
            "<",
            ">",
            "&",
            "|",
            "^",
            "return",
            "throw",
            "case",
            "delete",
            "do",
            "else",
            "void",
            "yield",
            "await",
        }:
            return True
        if (
            len(self.tokens) >= 2
            and self.tokens[-2].value == "="
            and previous == ">"
        ):
            return True
        if previous != ")":
            return previous == "}" and self._closing_brace_ends_block(
                segment_token_start
            )

        # A regex may begin the statement controlled by `if (...)`, `while
        # (...)`, and similar constructs. A close parenthesis in an ordinary
        # expression still leaves `/` as division.
        depth = 0
        for cursor in range(len(self.tokens) - 1, segment_token_start - 1, -1):
            value = self.tokens[cursor].value
            if value == ")":
                depth += 1
            elif value == "(":
                depth -= 1
                if depth == 0:
                    return (
                        cursor > segment_token_start
                        and self.tokens[cursor - 1].value
                        in {"for", "if", "switch", "while", "with"}
                    )
        return False

    def _closing_brace_ends_block(self, segment_token_start: int) -> bool:
        depth = 0
        open_index: int | None = None
        for cursor in range(len(self.tokens) - 1, segment_token_start - 1, -1):
            value = self.tokens[cursor].value
            if value == "}":
                depth += 1
            elif value == "{":
                depth -= 1
                if depth == 0:
                    open_index = cursor
                    break
        if open_index is None or open_index == segment_token_start:
            return open_index == segment_token_start
        previous = self.tokens[open_index - 1].value
        if previous in {"do", "else", "finally", "try"}:
            return True
        if previous != ")":
            return False

        paren_depth = 0
        for cursor in range(open_index - 1, segment_token_start - 1, -1):
            value = self.tokens[cursor].value
            if value == ")":
                paren_depth += 1
            elif value == "(":
                paren_depth -= 1
                if paren_depth == 0:
                    return (
                        cursor > segment_token_start
                        and self.tokens[cursor - 1].value
                        in {"for", "if", "switch", "while", "with"}
                    )
        return False

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
            if self.jsx and char == "<" and self._looks_like_jsx(index, segment_token_start):
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


def tokenize_typescript(text: str, *, jsx: bool = True) -> list[Token]:
    """Return executable TypeScript tokens plus cooked string literals.

    Comments, regular-expression bodies, JSX display text, and template prose
    are skipped. Executable JSX and template interpolations are scanned.
    """

    return _TypeScriptLexer(text, jsx=jsx).scan()


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


def _matching_pairs(
    tokens: list[Token], opener: str, closer: str
) -> dict[int, int]:
    stack: list[int] = []
    pairs: dict[int, int] = {}
    for index, token in enumerate(tokens):
        if token.value == opener:
            stack.append(index)
        elif token.value == closer and stack:
            pairs[stack.pop()] = index
    return pairs


def _type_sequence_reaches_import(
    tokens: list[Token], start_index: int, import_index: int
) -> bool:
    """Whether a multiline type sequence still owns the candidate import."""

    continuation_after = {
        "(",
        "[",
        "{",
        "<",
        "&",
        "|",
        "=",
        ",",
        ":",
        "?",
        "extends",
        "infer",
        "keyof",
        "new",
        "readonly",
        "typeof",
    }
    continuation_before = {".", "[", "&", "|", ":", "?", "extends"}
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    sequence = tokens[start_index:import_index]
    for index, token in enumerate(sequence):
        if index:
            previous = sequence[index - 1]
            if (
                token.lineno > previous.lineno
                and not nesting
                and previous.value not in continuation_after
                and token.value not in continuation_before
            ):
                return False
        if token.value in {"(", "[", "{", "<"}:
            nesting.append(token.value)
        elif token.value in matching and nesting and nesting[-1] == matching[token.value]:
            nesting.pop()

    if sequence:
        previous = sequence[-1]
        import_token = tokens[import_index]
        if (
            import_token.lineno > previous.lineno
            and not nesting
            and previous.value not in continuation_after
            and import_token.value not in continuation_before
        ):
            return False
    return True


def _type_alias_reaches_import(
    tokens: list[Token], type_index: int, import_index: int
) -> bool:
    if (
        type_index + 1 >= import_index
        or tokens[type_index + 1].kind != "identifier"
    ):
        return False

    # The import may occur in a type-parameter default/constraint before the
    # alias's own assignment: `type Box<T = import("pkg").T> = T`.
    if type_index + 2 < import_index and tokens[type_index + 2].value == "<":
        close_index = _matching_pairs(tokens, "<", ">").get(type_index + 2)
        if close_index is not None and import_index < close_index:
            cursor = close_index + 1
            while cursor < len(tokens) and tokens[cursor].value in {"?", "readonly"}:
                cursor += 1
            if cursor < len(tokens) and tokens[cursor].value == "=":
                return True

    # Find the alias assignment, ignoring defaults inside `<...>` type
    # parameters. `from` or a string before `=` identifies an import clause,
    # not a type-alias declaration.
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    equals_index: int | None = None
    for cursor in range(type_index + 2, import_index):
        token = tokens[cursor]
        if token.value == ";" or token.value == "from" or token.kind == "string":
            return False
        if token.value in {"(", "[", "{", "<"}:
            nesting.append(token.value)
        elif token.value in matching and nesting and nesting[-1] == matching[token.value]:
            nesting.pop()
        elif token.value == "=" and not nesting:
            equals_index = cursor
            break
    if equals_index is None:
        return False

    return _type_sequence_reaches_import(tokens, equals_index + 1, import_index)


def _is_function_parameter_list(
    tokens: list[Token], open_index: int, close_index: int
) -> bool:
    owner_index = open_index - 1
    if owner_index < 0:
        return False
    owner = tokens[owner_index].value
    if owner in {"for", "if", "switch", "while", "with"}:
        return False

    # A `function` keyword in this header is unambiguous. Stop at the nearest
    # body/statement boundary so a call inside a function body cannot inherit
    # the outer function's keyword.
    for cursor in range(open_index - 1, -1, -1):
        value = tokens[cursor].value
        if value in {";", "{", "}"}:
            break
        if value == "function":
            return True

    # Direct class/interface members are method or call signatures. A call in
    # a method body has that body (rather than the class body) as its nearest
    # containing brace and therefore does not take this path.
    containing_braces = [
        (brace_open, brace_close)
        for brace_open, brace_close in _matching_pairs(tokens, "{", "}").items()
        if brace_open < open_index < brace_close
    ]
    if containing_braces:
        brace_open, _ = max(containing_braces)
        header_start = brace_open - 1
        while header_start >= 0 and tokens[header_start].value not in {";", "{", "}"}:
            header_start -= 1
        header_values = {
            token.value for token in tokens[header_start + 1 : brace_open]
        }
        if header_values & {"class", "interface"}:
            return True

    # Arrow functions and object methods may declare a return type between
    # `)` and their arrow/body. Importantly, a bare `:` is not enough: it may
    # be the false branch of `condition ? call() : import(...)`.
    cursor = close_index + 1
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    while cursor < len(tokens):
        value = tokens[cursor].value
        if value in {"(", "[", "{", "<"}:
            if value == "{" and not nesting:
                return tokens[owner_index].kind == "identifier"
            nesting.append(value)
        elif value in matching and nesting and nesting[-1] == matching[value]:
            nesting.pop()
        elif not nesting:
            if value in {";", "}"}:
                return False
            if (
                value == "="
                and cursor + 1 < len(tokens)
                and tokens[cursor + 1].value == ">"
            ):
                return True
        cursor += 1
    return False


def _top_level_segment_start(
    tokens: list[Token], start_index: int, end_index: int
) -> int:
    """Return the start of the comma-delimited segment owning end_index."""

    segment_start = start_index
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    for cursor in range(start_index, end_index):
        value = tokens[cursor].value
        if value in {"(", "[", "{", "<"}:
            nesting.append(value)
        elif value in matching and nesting and nesting[-1] == matching[value]:
            nesting.pop()
        elif value == "," and not nesting:
            segment_start = cursor + 1
    return segment_start


def _top_level_annotation_colon(
    tokens: list[Token], start_index: int, import_index: int
) -> int | None:
    """Find a live annotation colon before import, excluding initializers."""

    colon_index: int | None = None
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    for cursor in range(start_index, import_index):
        value = tokens[cursor].value
        if value in {"(", "[", "{", "<"}:
            nesting.append(value)
        elif value in matching and nesting and nesting[-1] == matching[value]:
            nesting.pop()
        elif not nesting:
            if value == "=":
                return None
            if value == ":" and colon_index is None:
                colon_index = cursor
    if colon_index is None:
        return None
    if not _type_sequence_reaches_import(tokens, colon_index + 1, import_index):
        return None
    return colon_index


def _parameter_annotation_contains_import(
    tokens: list[Token], import_index: int
) -> bool:
    for open_index, close_index in _matching_pairs(tokens, "(", ")").items():
        if not (open_index < import_index < close_index):
            continue
        if not _is_function_parameter_list(tokens, open_index, close_index):
            continue
        segment_start = _top_level_segment_start(
            tokens, open_index + 1, import_index
        )
        if _top_level_annotation_colon(tokens, segment_start, import_index) is not None:
            return True
    return False


def _interface_property_contains_import(
    tokens: list[Token], import_index: int
) -> bool:
    # Every executable-looking import inside an interface body is necessarily
    # part of a type member/signature. Use the declared interface body rather
    # than the innermost brace so nested object types remain covered.
    for open_index, close_index in _matching_pairs(tokens, "{", "}").items():
        if not (open_index < import_index < close_index):
            continue
        header_start = open_index - 1
        while header_start >= 0 and tokens[header_start].value not in {";", "{", "}"}:
            header_start -= 1
        header = tokens[header_start + 1 : open_index]
        if any(token.value == "interface" for token in header):
            return True
    return False


def _function_return_annotation_contains_import(
    tokens: list[Token], import_index: int
) -> bool:
    parens = _matching_pairs(tokens, "(", ")")
    closing_parens = {close: open_index for open_index, close in parens.items()}
    for colon_index in range(import_index - 1, -1, -1):
        if tokens[colon_index].value in {";", "{", "}"}:
            return False
        if tokens[colon_index].value != ":" or colon_index == 0:
            continue
        close_index = colon_index - 1
        open_index = closing_parens.get(close_index)
        if open_index is None:
            continue
        if _is_function_parameter_list(tokens, open_index, close_index):
            if not _type_sequence_reaches_import(
                tokens, colon_index + 1, import_index
            ):
                return False

            # An outer arrow before the candidate starts the runtime body.
            # Arrows nested in parentheses/brackets/braces belong to the type.
            nesting: list[str] = []
            matching = {")": "(", "]": "[", "}": "{", ">": "<"}
            for cursor in range(colon_index + 1, import_index):
                value = tokens[cursor].value
                if value in {"(", "[", "{", "<"}:
                    nesting.append(value)
                elif value in matching and nesting and nesting[-1] == matching[value]:
                    nesting.pop()
                elif (
                    not nesting
                    and value == "="
                    and cursor + 1 < import_index
                    and tokens[cursor + 1].value == ">"
                ):
                    return False
            return True
    return False


def _class_property_contains_import(
    tokens: list[Token], import_index: int
) -> bool:
    containing_class_bodies: list[tuple[int, int]] = []
    for open_index, close_index in _matching_pairs(tokens, "{", "}").items():
        if not (open_index < import_index < close_index):
            continue
        header_start = open_index - 1
        while header_start >= 0 and tokens[header_start].value not in {";", "{", "}"}:
            header_start -= 1
        if any(
            token.value == "class"
            for token in tokens[header_start + 1 : open_index]
        ):
            containing_class_bodies.append((open_index, close_index))
    if not containing_class_bodies:
        return False

    class_open, _ = max(containing_class_bodies)
    member_start = class_open + 1
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    colon_index: int | None = None
    for cursor in range(member_start, import_index):
        value = tokens[cursor].value
        if value in {"(", "[", "{", "<"}:
            if value == "{" and not nesting:
                # A brace after an initializer or a completed method return
                # type is a runtime body. A brace immediately starting (or
                # extending) the annotation is a type literal.
                if colon_index is None:
                    return False
                prefix = tokens[colon_index + 1 : cursor]
                if prefix and prefix[-1].value not in {
                    "&",
                    "|",
                    "=",
                    "(",
                    "[",
                    "{",
                    ",",
                    ":",
                    "?",
                    "extends",
                }:
                    return False
            nesting.append(value)
        elif value in matching and nesting and nesting[-1] == matching[value]:
            nesting.pop()
        elif not nesting:
            if value == ";":
                member_start = cursor + 1
                colon_index = None
            elif value == "=":
                return False
            elif value == ":" and colon_index is None:
                colon_index = cursor

    return colon_index is not None and _type_sequence_reaches_import(
        tokens, colon_index + 1, import_index
    )


def _declaration_annotation_contains_import(
    tokens: list[Token], import_index: int
) -> bool:
    declaration_index: int | None = None
    for cursor in range(import_index - 1, -1, -1):
        if tokens[cursor].value == ";":
            break
        if tokens[cursor].value in {"const", "let", "var"}:
            declaration_index = cursor
            break
    if declaration_index is None:
        return False
    declarator_start = _top_level_segment_start(
        tokens, declaration_index + 1, import_index
    )
    return (
        _top_level_annotation_colon(tokens, declarator_start, import_index)
        is not None
    )


def _generic_argument_contains_import(
    tokens: list[Token], import_index: int
) -> bool:
    for open_index, close_index in _matching_pairs(tokens, "<", ">").items():
        if not (open_index < import_index < close_index):
            continue

        # `await import()` cannot occur in a TypeScript type argument. This
        # also disambiguates comparisons such as
        # `left < (await import("pkg")).default > (right)`.
        if any(
            token.value in {"await", "delete", "throw", "yield"}
            for token in tokens[open_index + 1 : import_index]
        ):
            continue

        after = tokens[close_index + 1].value if close_index + 1 < len(tokens) else None
        owner_index = open_index - 1
        if (
            owner_index >= 2
            and tokens[owner_index].value == "."
            and tokens[owner_index - 1].value == "?"
        ):
            owner_index -= 2
        owner = tokens[owner_index] if owner_index >= 0 else None

        # Generic calls and generic declarations immediately followed by their
        # parameter list are definite type-argument contexts.
        if close_index + 1 < len(tokens) and tokens[close_index + 1].value == "(":
            return True

        header_start = open_index - 1
        while header_start >= 0 and tokens[header_start].value not in {";", "{", "}"}:
            header_start -= 1
        header_values = {
            token.value for token in tokens[header_start + 1 : open_index]
        }
        if header_values & {"as", "implements", "interface", "satisfies", "type"}:
            return True

        # Type parameters on class/function/arrow declarations use constraints
        # or defaults before an import type.
        inner_prefix = {
            token.value for token in tokens[open_index + 1 : import_index]
        }
        if inner_prefix & {"extends", "="} and (
            header_values & {"class", "function", "interface", "type"}
            or owner is None
            or (owner is not None and owner.value in {"=", "("})
        ):
            return True

        # Angle-bracket assertions begin where an expression may begin and do
        # not have a value owner immediately to their left.
        assertion_prefixes = {
            None,
            "(",
            "[",
            "{",
            ",",
            ":",
            "=",
            "?",
            "=>",
            "return",
            "yield",
        }
        owner_value = owner.value if owner is not None else None
        if owner_value in assertion_prefixes:
            return True

        # Instantiation expressions (`const C = Factory<Type>`) and generic
        # type references end at a delimiter/member operator. A comparison has
        # a right-hand value after `>` and is deliberately not accepted here.
        if owner is not None and owner.kind == "identifier" and after in {
            None,
            ";",
            ",",
            ")",
            "]",
            "}",
            ".",
            "?",
            "!",
            "[",
            "as",
            "satisfies",
        }:
            return True
    return False


def _type_operator_reaches_import(
    tokens: list[Token], import_index: int
) -> bool:
    """Recognize nested types owned by `as`, `satisfies`, or `implements`."""

    for operator_index in range(import_index - 1, -1, -1):
        value = tokens[operator_index].value
        if value == ";":
            return False
        if value not in {"as", "implements", "satisfies"}:
            continue
        return _type_sequence_reaches_import(
            tokens, operator_index + 1, import_index
        )
    return False


def _is_import_type_expression(tokens: list[Token], import_index: int) -> bool:
    """Recognize dynamic-import syntax used as a TypeScript import type."""

    statement_floor = import_index
    while statement_floor > 0 and tokens[statement_floor - 1].value != ";":
        statement_floor -= 1
    for type_index in range(import_index - 1, statement_floor - 1, -1):
        if tokens[type_index].value == "type" and _type_alias_reaches_import(
            tokens, type_index, import_index
        ):
            return True
    if _parameter_annotation_contains_import(tokens, import_index):
        return True
    if _interface_property_contains_import(tokens, import_index):
        return True
    if _function_return_annotation_contains_import(tokens, import_index):
        return True
    if _class_property_contains_import(tokens, import_index):
        return True
    if _declaration_annotation_contains_import(tokens, import_index):
        return True
    if _generic_argument_contains_import(tokens, import_index):
        return True
    return _type_operator_reaches_import(tokens, import_index)


def _dynamic_import_binding_facts(
    tokens: list[Token], import_index: int
) -> tuple[frozenset[str], frozenset[str], frozenset[str]]:
    """Return imported names, local names, and namespace names for assignments."""

    cursor = import_index - 1
    while cursor >= 0 and tokens[cursor].value in {"await", "("}:
        cursor -= 1
    if cursor < 1 or tokens[cursor].value != "=":
        return frozenset(), frozenset(), frozenset()

    pattern_end = cursor - 1
    if tokens[pattern_end].kind == "identifier":
        if pattern_end > 0 and tokens[pattern_end - 1].value in {".", "?"}:
            return frozenset(), frozenset(), frozenset()
        binding = tokens[pattern_end].value
        return frozenset(), frozenset({binding}), frozenset({binding})
    if tokens[pattern_end].value != "}":
        return frozenset(), frozenset(), frozenset()

    depth = 0
    pattern_start: int | None = None
    for index in range(pattern_end, -1, -1):
        value = tokens[index].value
        if value == "}":
            depth += 1
        elif value == "{":
            depth -= 1
            if depth == 0:
                pattern_start = index
                break
    if pattern_start is None:
        return frozenset(), frozenset(), frozenset()

    entries: list[list[Token]] = []
    current: list[Token] = []
    nesting = 0
    for token in tokens[pattern_start + 1 : pattern_end]:
        if token.value in {"{", "[", "("}:
            nesting += 1
        elif token.value in {"}", "]", ")"}:
            nesting -= 1
        if token.value == "," and nesting == 0:
            entries.append(current)
            current = []
        else:
            current.append(token)
    entries.append(current)

    imported: set[str] = set()
    local: set[str] = set()
    for entry in entries:
        identifiers = [token.value for token in entry if token.kind == "identifier"]
        if not identifiers:
            continue
        imported_name = identifiers[0]
        imported.add(imported_name)
        colon = next(
            (index for index, token in enumerate(entry) if token.value == ":"),
            None,
        )
        local_name = (
            next(
                (
                    token.value
                    for token in entry[colon + 1 :]
                    if token.kind == "identifier"
                ),
                imported_name,
            )
            if colon is not None
            else imported_name
        )
        local.add(local_name)
    return frozenset(imported), frozenset(local), frozenset()


def collect_imports(path: Path, text: str) -> list[ImportStatement]:
    """Collect static imports, re-exports, and quoted dynamic imports."""

    tokens = tokenize_typescript(text, jsx=path.suffix == ".tsx")
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
                imported_names, local_bindings, namespace_bindings = (
                    _dynamic_import_binding_facts(tokens, index)
                )
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
                        imported_names=imported_names,
                        local_bindings=local_bindings,
                        namespace_bindings=namespace_bindings,
                        start=token.start,
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
                start=token.start,
            )
        )
        index = source_index + 1

    return imports


def is_type_only_import(statement: str) -> bool:
    tokens = tokenize_typescript(statement)
    if not tokens or tokens[0].value not in {"import", "export"}:
        return False
    return _is_type_only_tokens(tokens, tokens[0].value)
