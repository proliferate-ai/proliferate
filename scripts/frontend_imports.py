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
    scoped_bindings: tuple[ScopedBinding, ...] = ()
    start: int = -1


@dataclass(frozen=True)
class ScopedBinding:
    name: str
    start: int
    end: int
    namespace: bool = False


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
        previous_index = len(self.tokens) - 1
        previous = self.tokens[-1].value

        # TypeScript's postfix non-null assertion leaves `/` as division,
        # while prefix logical negation still permits a regular expression.
        if previous == "!":
            return not self._is_postfix_non_null(
                previous_index, segment_token_start
            )

        # The lexer stores punctuation one character at a time. Reconstitute
        # an adjacent postfix increment/decrement here so its trailing slash
        # is not mistaken for a regex. Spaced unary operators remain separate.
        if (
            previous in {"+", "-"}
            and previous_index > segment_token_start
            and self.tokens[previous_index - 1].value == previous
            and self.tokens[previous_index - 1].end
            == self.tokens[previous_index].start
            and self._token_ends_expression(
                previous_index - 2, segment_token_start
            )
            and self.tokens[previous_index - 2].lineno
            == self.tokens[previous_index - 1].lineno
        ):
            return False

        # `in` and `instanceof` are binary operators and `typeof` is unary,
        # so each can be followed by a regex operand. The same spellings used
        # as property names still end an ordinary member expression.
        if previous in {"in", "instanceof", "typeof"}:
            return not self._is_property_name(previous_index)
        if previous == "of" and self._is_contextual_for_of(
            previous_index, segment_token_start
        ):
            return True

        if previous in {
            "(",
            "[",
            "{",
            ",",
            ";",
            ":",
            "=",
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

    def _is_property_name(self, index: int) -> bool:
        return index > 0 and self.tokens[index - 1].value == "."

    def _token_ends_expression(
        self, index: int, segment_token_start: int
    ) -> bool:
        if index < segment_token_start:
            return False
        token = self.tokens[index]
        if token.kind == "string" or token.value in {")", "]", "}"}:
            return True
        if token.value == "!":
            return self._is_postfix_non_null(index, segment_token_start)
        if token.kind != "identifier":
            return token.value.isdigit()
        return token.value not in {
            "await",
            "case",
            "delete",
            "do",
            "else",
            "in",
            "instanceof",
            "new",
            "return",
            "throw",
            "typeof",
            "void",
            "yield",
        }

    def _is_postfix_non_null(
        self, index: int, segment_token_start: int
    ) -> bool:
        return index > segment_token_start and self._token_ends_expression(
            index - 1, segment_token_start
        )

    def _is_contextual_for_of(
        self, of_index: int, segment_token_start: int
    ) -> bool:
        if self._is_property_name(of_index):
            return False

        # Find the still-open parenthesis containing this token. `of` is the
        # for-of delimiter only at the top level of a `for (...)` header and
        # only after a left-hand binding/expression.
        depth = 0
        open_index: int | None = None
        for cursor in range(of_index - 1, segment_token_start - 1, -1):
            value = self.tokens[cursor].value
            if value == ")":
                depth += 1
            elif value == "(":
                if depth:
                    depth -= 1
                else:
                    open_index = cursor
                    break
        if open_index is None or of_index <= open_index + 1:
            return False
        owner_index = open_index - 1
        if owner_index >= 0 and self.tokens[owner_index].value == "await":
            owner_index -= 1
        if owner_index < 0 or self.tokens[owner_index].value != "for":
            return False

        nesting = 0
        for token in self.tokens[open_index + 1 : of_index]:
            if token.value in {"(", "[", "{"}:
                nesting += 1
            elif token.value in {")", "]", "}"} and nesting:
                nesting -= 1
            elif token.value == ";" and not nesting:
                return False
        return True

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
        class_index = next(
            (
                cursor
                for cursor in range(open_index - 1, segment_token_start - 1, -1)
                if self.tokens[cursor].value == "class"
            ),
            None,
        )
        if (
            class_index is not None
            and self._is_class_body_open(class_index, open_index)
            and self._keyword_starts_declaration(class_index, segment_token_start)
        ):
            return True
        function_index = next(
            (
                cursor
                for cursor in range(open_index - 1, segment_token_start - 1, -1)
                if self.tokens[cursor].value == "function"
            ),
            None,
        )
        if (
            function_index is not None
            and self._is_function_body_open(function_index, open_index)
            and self._keyword_starts_declaration(function_index, segment_token_start)
        ):
            return True
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
                    if cursor <= segment_token_start:
                        return False
                    owner = self.tokens[cursor - 1].value
                    if owner in {
                        "catch",
                        "for",
                        "if",
                        "switch",
                        "while",
                        "with",
                    }:
                        return True
                    function_index = next(
                        (
                            candidate
                            for candidate in range(
                                cursor - 1, segment_token_start - 1, -1
                            )
                            if self.tokens[candidate].value == "function"
                        ),
                        None,
                    )
                    return (
                        function_index is not None
                        and self._keyword_starts_declaration(
                            function_index, segment_token_start
                        )
                    )
        return False

    def _is_class_body_open(self, class_index: int, open_index: int) -> bool:
        nesting: list[str] = []
        matching = {")": "(", "]": "[", ">": "<"}
        for cursor in range(class_index + 1, open_index):
            value = self.tokens[cursor].value
            if value in {"(", "[", "<"}:
                nesting.append(value)
            elif value in matching and nesting and nesting[-1] == matching[value]:
                nesting.pop()
            elif value == "{" and not nesting:
                return False
        return True

    def _is_function_body_open(
        self, function_index: int, candidate_open: int
    ) -> bool:
        parameter_open: int | None = None
        angle_depth = 0
        for cursor in range(function_index + 1, candidate_open):
            value = self.tokens[cursor].value
            if value == "<":
                angle_depth += 1
            elif value == ">" and angle_depth:
                angle_depth -= 1
            elif value == "(" and angle_depth == 0:
                parameter_open = cursor
                break
        if parameter_open is None:
            return False

        depth = 0
        parameter_close: int | None = None
        for cursor in range(parameter_open, candidate_open):
            value = self.tokens[cursor].value
            if value == "(":
                depth += 1
            elif value == ")":
                depth -= 1
                if depth == 0:
                    parameter_close = cursor
                    break
        if parameter_close is None:
            return False
        if parameter_close + 1 == candidate_open:
            return True
        if self.tokens[parameter_close + 1].value != ":":
            return False

        nesting: list[str] = []
        matching = {")": "(", "]": "[", "}": "{", ">": "<"}
        saw_complete_type = False
        type_literal_prefixes = {
            "&",
            "|",
            "=",
            ">",
            "(",
            "[",
            "{",
            ",",
            ":",
            "?",
            "extends",
            "keyof",
            "readonly",
            "typeof",
        }
        for cursor in range(parameter_close + 2, candidate_open + 1):
            value = self.tokens[cursor].value
            if value in {"(", "[", "{", "<"}:
                if value == "{" and not nesting:
                    is_type_literal = (
                        not saw_complete_type
                        or self.tokens[cursor - 1].value in type_literal_prefixes
                    )
                    if cursor == candidate_open:
                        return not is_type_literal
                    if not is_type_literal:
                        return False
                nesting.append(value)
                saw_complete_type = True
            elif value in matching and nesting and nesting[-1] == matching[value]:
                nesting.pop()
                saw_complete_type = True
            elif not nesting and value not in {"&", "|", ":", "?", "extends"}:
                saw_complete_type = True
        return False

    def _keyword_starts_declaration(
        self, keyword_index: int, segment_token_start: int
    ) -> bool:
        cursor = keyword_index - 1
        while cursor >= segment_token_start and self.tokens[cursor].value in {
            "abstract",
            "async",
            "declare",
            "default",
            "export",
        }:
            cursor -= 1
        return cursor < segment_token_start or self.tokens[cursor].value in {
            ";",
            "{",
            "}",
        }

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


def _statement_end(
    tokens: list[Token], source_index: int, *, import_equals: bool
) -> int:
    """Return the grammar end of one static import/re-export statement."""

    cursor = source_index + 1
    end = tokens[source_index].end
    if import_equals and cursor < len(tokens) and tokens[cursor].value == ")":
        end = tokens[cursor].end
        cursor += 1

    if (
        cursor + 1 < len(tokens)
        and tokens[cursor].value in {"assert", "with"}
        and tokens[cursor + 1].value == "{"
    ):
        attribute_close = _matching_pairs(tokens, "{", "}").get(cursor + 1)
        if attribute_close is not None:
            end = tokens[attribute_close].end
            cursor = attribute_close + 1

    if cursor < len(tokens) and tokens[cursor].value == ";":
        return tokens[cursor].end
    return end


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
        and tokens[2].value not in {",", "=", "from"}
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
            previous_continues = previous.value in continuation_after or (
                previous.value == ">"
                and index >= 2
                and sequence[index - 2].value == "="
            )
            token_continues = token.value in continuation_before or (
                token.value == "="
                and index + 1 < len(sequence)
                and sequence[index + 1].value == ">"
            )
            if (
                token.lineno > previous.lineno
                and not nesting
                and not previous_continues
                and not token_continues
            ):
                return False
        if token.value in {"(", "[", "{", "<"}:
            nesting.append(token.value)
        elif token.value in matching and nesting and nesting[-1] == matching[token.value]:
            nesting.pop()

    if sequence:
        previous = sequence[-1]
        import_token = tokens[import_index]
        previous_continues = previous.value in continuation_after or (
            previous.value == ">"
            and len(sequence) >= 2
            and sequence[-2].value == "="
        )
        if (
            import_token.lineno > previous.lineno
            and not nesting
            and not previous_continues
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
        if cursor >= close_index + 1 and not nesting:
            previous_token = tokens[cursor - 1]
            if (
                tokens[cursor].lineno > previous_token.lineno
                and previous_token.value not in {
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
                }
                and value not in {".", "[", "&", "|", ":", "?", "=", "{"}
            ):
                return False
        if value in {"(", "[", "{", "<"}:
            if value == "{" and not nesting:
                previous_value = tokens[cursor - 1].value
                if cursor == close_index + 1 or previous_value not in {
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
                    "keyof",
                    "readonly",
                    "typeof",
                }:
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
                if (
                    cursor + 1 < import_index
                    and tokens[cursor + 1].value == ">"
                ):
                    continue
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
    for open_index, close_index in parens.items():
        colon_index = close_index + 1
        if (
            colon_index >= import_index
            or colon_index >= len(tokens)
            or tokens[colon_index].value != ":"
        ):
            continue
        if not _is_function_parameter_list(tokens, open_index, close_index):
            continue
        if not _type_annotation_prefix_reaches_import(
            tokens, colon_index + 1, import_index
        ):
            continue

        # A top-level arrow can either be part of a function return type or be
        # the outer arrow that begins a runtime expression. Function
        # declarations/methods have no outer arrow. For arrow functions, a
        # later arrow after the candidate means the earlier one belonged to
        # the declared return type.
        top_level_arrows = _top_level_arrow_indices(
            tokens, colon_index + 1, import_index
        )
        if top_level_arrows and not _parameter_list_has_declaration_owner(
            tokens, open_index
        ):
            if not _has_later_arrow_before_statement_end(tokens, import_index):
                continue
        return True
    return False


def _type_annotation_prefix_reaches_import(
    tokens: list[Token], start_index: int, import_index: int
) -> bool:
    """Keep a type annotation live until its initializer/body boundary."""

    if not _type_sequence_reaches_import(tokens, start_index, import_index):
        return False
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    saw_complete_type = False
    type_literal_prefixes = {
        "&",
        "|",
        "=",
        ">",
        "(",
        "[",
        "{",
        ",",
        ":",
        "?",
        "extends",
        "keyof",
        "readonly",
        "typeof",
    }
    for cursor in range(start_index, import_index):
        value = tokens[cursor].value
        if value in {"(", "[", "{", "<"}:
            if (
                value == "{"
                and not nesting
                and saw_complete_type
                and tokens[cursor - 1].value not in type_literal_prefixes
            ):
                return False
            nesting.append(value)
            saw_complete_type = True
        elif value in matching:
            if (
                value == ">"
                and cursor > start_index
                and tokens[cursor - 1].value == "="
            ):
                saw_complete_type = True
                continue
            if not nesting or nesting[-1] != matching[value]:
                return False
            nesting.pop()
            saw_complete_type = True
        elif not nesting:
            if value == ";":
                return False
            if value == "=" and not (
                cursor + 1 < import_index and tokens[cursor + 1].value == ">"
            ):
                return False
            if value not in {"&", "|", ":", "?", "extends"}:
                saw_complete_type = True
    return True


def _top_level_arrow_indices(
    tokens: list[Token], start_index: int, end_index: int
) -> list[int]:
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    arrows: list[int] = []
    for cursor in range(start_index, end_index):
        value = tokens[cursor].value
        if value in {"(", "[", "{", "<"}:
            nesting.append(value)
        elif value in matching and nesting and nesting[-1] == matching[value]:
            nesting.pop()
        elif (
            not nesting
            and value == "="
            and cursor + 1 < end_index
            and tokens[cursor + 1].value == ">"
        ):
            arrows.append(cursor)
    return arrows


def _parameter_list_has_declaration_owner(
    tokens: list[Token], open_index: int
) -> bool:
    for cursor in range(open_index - 1, -1, -1):
        if tokens[cursor].value in {";", "{", "}"}:
            break
        if tokens[cursor].value == "function":
            return True
    containing_braces = [
        (brace_open, brace_close)
        for brace_open, brace_close in _matching_pairs(tokens, "{", "}").items()
        if brace_open < open_index < brace_close
    ]
    if not containing_braces:
        return False
    brace_open, _ = max(containing_braces)
    header_start = brace_open - 1
    while header_start >= 0 and tokens[header_start].value not in {";", "{", "}"}:
        header_start -= 1
    return any(
        token.value in {"class", "interface"}
        for token in tokens[header_start + 1 : brace_open]
    )


def _has_later_arrow_before_statement_end(
    tokens: list[Token], import_index: int
) -> bool:
    # Dynamic import's own parentheses are balanced before any relevant outer
    # arrow. Looking to the next semicolon is sufficient to distinguish a
    # function-valued return annotation from the arrow's runtime body.
    for cursor in range(import_index + 1, len(tokens) - 1):
        if tokens[cursor].value == ";":
            return False
        if tokens[cursor].value == "=" and tokens[cursor + 1].value == ">":
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


def _generic_call_import_is_type(
    tokens: list[Token],
    generic_open: int,
    generic_close: int,
    import_index: int,
) -> bool:
    """Whether an import has type grammar inside a generic call span."""

    import_open = import_index + 1
    import_close = _matching_pairs(tokens, "(", ")").get(import_open)
    if import_close is None or import_close >= generic_close:
        return False

    # Import types require their literal/options grammar. An asserted module
    # expression remains a runtime dynamic import even when the literal under
    # the assertion is statically discoverable.
    if any(
        token.value in {"as", "satisfies"}
        for token in tokens[import_open + 1 : import_close]
    ):
        return False

    # A direct `.Name` is an import-type qualifier. Once grouping has closed
    # around the import, `.Name` is instead a runtime property read and makes
    # TypeScript fall back to relational-expression parsing. Indexed access
    # remains legal on a parenthesized type.
    closed_group = False
    for cursor in range(import_close + 1, generic_close):
        value = tokens[cursor].value
        if value in {"as", "satisfies", "await"}:
            return False
        if value == ")":
            closed_group = True
        elif value == "." and closed_group:
            return False
        elif value == "(":
            # Calls such as `import("pkg").then(load)` are runtime values,
            # not type arguments.
            return False
    return True


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

        header_start = open_index - 1
        while header_start >= 0 and tokens[header_start].value not in {";", "{", "}"}:
            header_start -= 1
        header_values = {
            token.value for token in tokens[header_start + 1 : open_index]
        }
        if header_values & {"implements", "interface", "type"}:
            return True
        type_operator_index = next(
            (
                cursor
                for cursor in range(open_index - 1, header_start, -1)
                if tokens[cursor].value in {"as", "satisfies"}
            ),
            None,
        )
        if type_operator_index is not None and not any(
            token.value in {")", "]", "}"}
            for token in tokens[type_operator_index + 1 : open_index]
        ):
            return True
        if "class" in header_values and "extends" in header_values:
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

        # TypeScript parses a valid type argument followed by `(...)` as a
        # generic call regardless of whitespace around `<` and `>`. Reject
        # runtime grouping/assertion shapes rather than relying on adjacency.
        if after == "(":
            optional_call = (
                open_index >= 2
                and tokens[open_index - 1].value == "."
                and tokens[open_index - 2].value == "?"
            )
            if optional_call or _generic_call_import_is_type(
                tokens, open_index, close_index, import_index
            ):
                return True
            continue

        if (
            close_index + 1 < len(tokens)
            and tokens[close_index + 1].kind == "string"
            and tokens[close_index + 1].start == tokens[close_index].end
        ):
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
        if operator_index + 1 > import_index:
            continue
        previous = tokens[operator_index - 1].value if operator_index else None
        following = tokens[operator_index + 1].value
        if previous in {".", "?"} or following in {":", "=", "("}:
            continue
        if value == "implements" and not any(
            token.value == "class" for token in tokens[:operator_index]
        ):
            continue
        if not _type_sequence_reaches_import(
            tokens, operator_index + 1, import_index
        ):
            continue

        nesting: list[str] = []
        matching = {")": "(", "]": "[", "}": "{", ">": "<"}
        saw_conditional_extends = False
        for cursor in range(operator_index + 1, import_index):
            token_value = tokens[cursor].value
            if token_value in {"(", "[", "{", "<"}:
                nesting.append(token_value)
            elif token_value in matching:
                if not nesting or nesting[-1] != matching[token_value]:
                    break
                nesting.pop()
            elif not nesting:
                if token_value == "extends":
                    saw_conditional_extends = True
                elif token_value in {",", ";", "="}:
                    break
                elif token_value in {"+", "-", "*", "/", "%", "^"}:
                    break
                elif token_value in {"?", ":"} and not saw_conditional_extends:
                    break
                elif (
                    token_value in {"&", "|"}
                    and cursor + 1 < import_index
                    and tokens[cursor + 1].value == token_value
                ):
                    break
        else:
            return True
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
) -> tuple[
    frozenset[str],
    frozenset[str],
    frozenset[str],
    tuple[ScopedBinding, ...],
]:
    """Return original export names, locals, and namespace locals."""

    parens = _matching_pairs(tokens, "(", ")")
    close_index = parens.get(import_index + 1)
    if close_index is None:
        return frozenset(), frozenset(), frozenset(), ()

    imported: set[str] = set()
    local: set[str] = set()
    namespaces: set[str] = set()

    member_name = _member_name_after(tokens, close_index)
    if member_name is not None:
        imported.add(member_name)

    equals_index = _direct_dynamic_assignment(tokens, import_index)
    if equals_index is not None:
        pattern = _assignment_pattern(tokens, equals_index)
        if pattern:
            if pattern[0].value == "{":
                pattern_imported, pattern_local, pattern_namespaces = (
                    _destructuring_import_facts(pattern)
                )
                imported.update(pattern_imported)
                local.update(pattern_local)
                namespaces.update(pattern_namespaces)
            else:
                binding_names = _binding_names_from_pattern(pattern)
                local.update(binding_names)
                if member_name is None:
                    imported.add("*")
                    namespaces.update(binding_names)

    # Promise-style dynamic imports expose callback destructuring just as an
    # awaited destructure does. These names are deliberately not added to the
    # global local-binding set because their scope is only the callback.
    then_imported, scoped_bindings = _then_callback_import_facts(
        tokens, import_index, close_index
    )
    imported.update(then_imported)
    return (
        frozenset(imported),
        frozenset(local),
        frozenset(namespaces),
        scoped_bindings,
    )


def _split_top_level_entries(tokens: list[Token]) -> list[list[Token]]:
    entries: list[list[Token]] = []
    current: list[Token] = []
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    for token in tokens:
        value = token.value
        if value in {"(", "[", "{", "<"}:
            nesting.append(value)
        elif value in matching and nesting and nesting[-1] == matching[value]:
            nesting.pop()
        if value == "," and not nesting:
            entries.append(current)
            current = []
        else:
            current.append(token)
    if current:
        entries.append(current)
    return entries


def _top_level_token_index(tokens: list[Token], value: str) -> int | None:
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    for index, token in enumerate(tokens):
        if token.value in {"(", "[", "{", "<"}:
            nesting.append(token.value)
        elif token.value in matching and nesting and nesting[-1] == matching[token.value]:
            nesting.pop()
        elif token.value == value and not nesting:
            return index
    return None


def _binding_names_from_pattern(tokens: list[Token]) -> set[str]:
    while tokens and tokens[0].value in {".", "readonly"}:
        tokens = tokens[1:]
    if not tokens:
        return set()
    if tokens[0].kind == "identifier":
        return {tokens[0].value}
    if tokens[0].value not in {"{", "["}:
        return set()

    closer = "}" if tokens[0].value == "{" else "]"
    inner = tokens[1:]
    if inner and inner[-1].value == closer:
        inner = inner[:-1]
    bindings: set[str] = set()
    for entry in _split_top_level_entries(inner):
        if not entry:
            continue
        while entry and entry[0].value == ".":
            entry = entry[1:]
        colon_index = _top_level_token_index(entry, ":")
        equals_index = _top_level_token_index(entry, "=")
        if colon_index is not None:
            end = equals_index if equals_index is not None else len(entry)
            bindings.update(
                _binding_names_from_pattern(entry[colon_index + 1 : end])
            )
        elif entry and entry[0].kind == "identifier":
            bindings.add(entry[0].value)
    return bindings


def _destructuring_import_facts(
    pattern: list[Token],
) -> tuple[set[str], set[str], set[str]]:
    inner = pattern[1:-1] if pattern[-1].value == "}" else pattern[1:]
    imported: set[str] = set()
    local: set[str] = set()
    namespaces: set[str] = set()
    for entry in _split_top_level_entries(inner):
        if not entry:
            continue
        if len(entry) >= 4 and all(token.value == "." for token in entry[:3]):
            rest = next(
                (token.value for token in entry[3:] if token.kind == "identifier"),
                None,
            )
            if rest is not None:
                imported.add("*")
                local.add(rest)
                namespaces.add(rest)
            continue

        colon_index = _top_level_token_index(entry, ":")
        equals_index = _top_level_token_index(entry, "=")
        imported_name: str | None = None
        if entry[0].value == "[":
            close_bracket = next(
                (index for index, token in enumerate(entry) if token.value == "]"),
                None,
            )
            if close_bracket == 2 and entry[1].kind == "string":
                imported_name = entry[1].value
        elif entry[0].kind in {"identifier", "string"}:
            imported_name = entry[0].value
        if imported_name is None:
            continue
        imported.add(imported_name)

        if colon_index is not None:
            end = equals_index if equals_index is not None else len(entry)
            local.update(
                _binding_names_from_pattern(entry[colon_index + 1 : end])
            )
        elif entry[0].kind == "identifier":
            local.add(entry[0].value)
    return imported, local, namespaces


def _call_open_after_member(tokens: list[Token], member_index: int) -> int | None:
    """Return a direct or generic member call's opening parenthesis."""

    cursor = member_index + 1
    if cursor < len(tokens) and tokens[cursor].value == "(":
        return cursor
    if cursor >= len(tokens) or tokens[cursor].value != "<":
        return None
    generic_close = _matching_pairs(tokens, "<", ">").get(cursor)
    if (
        generic_close is None
        or generic_close + 1 >= len(tokens)
        or tokens[generic_close + 1].value != "("
    ):
        return None
    return generic_close + 1


def _member_name_after(tokens: list[Token], close_index: int) -> str | None:
    cursor = close_index + 1
    while cursor < len(tokens) and tokens[cursor].value == ")":
        cursor += 1
    if cursor < len(tokens) and tokens[cursor].value == "?":
        cursor += 1
    if (
        cursor + 1 < len(tokens)
        and tokens[cursor].value == "."
        and tokens[cursor + 1].kind == "identifier"
    ):
        if (
            tokens[cursor + 1].value in {"catch", "finally", "then"}
            and _call_open_after_member(tokens, cursor + 1) is not None
        ):
            return None
        return tokens[cursor + 1].value
    if (
        cursor + 2 < len(tokens)
        and tokens[cursor].value == "["
        and tokens[cursor + 1].kind == "string"
        and tokens[cursor + 2].value == "]"
    ):
        return tokens[cursor + 1].value
    return None


def _direct_dynamic_assignment(tokens: list[Token], import_index: int) -> int | None:
    cursor = import_index - 1
    while cursor >= 0 and tokens[cursor].value in {"(", "await"}:
        cursor -= 1
    if cursor >= 0 and tokens[cursor].value == "=":
        return cursor
    return None


def _assignment_pattern(tokens: list[Token], equals_index: int) -> list[Token]:
    declaration_index: int | None = None
    for cursor in range(equals_index - 1, -1, -1):
        if tokens[cursor].value == ";":
            break
        if tokens[cursor].value in {"const", "let", "var"}:
            declaration_index = cursor
            break
    start = declaration_index + 1 if declaration_index is not None else 0
    pattern = tokens[start:equals_index]
    declarators = _split_top_level_entries(pattern)
    if declarators:
        pattern = declarators[-1]
    colon_index = _top_level_token_index(pattern, ":")
    if colon_index is not None:
        pattern = pattern[:colon_index]
    return pattern


def _then_callback_import_facts(
    tokens: list[Token], import_index: int, import_close_index: int
) -> tuple[set[str], tuple[ScopedBinding, ...]]:
    cursor = import_close_index + 1
    grouping_count = 0
    prefix = import_index - 1
    if prefix >= 0 and tokens[prefix].value == "await":
        prefix -= 1
    while prefix >= 0 and tokens[prefix].value == "(":
        previous = tokens[prefix - 1] if prefix else None
        if previous is not None and previous.kind == "identifier" and previous.value not in {
            "await",
            "case",
            "delete",
            "return",
            "throw",
            "typeof",
            "void",
            "yield",
        }:
            break
        grouping_count += 1
        prefix -= 1
    while grouping_count and cursor < len(tokens) and tokens[cursor].value == ")":
        cursor += 1
        grouping_count -= 1
    if (
        cursor + 1 >= len(tokens)
        or tokens[cursor].value != "."
        or tokens[cursor + 1].value != "then"
    ):
        return set(), ()

    then_open = _call_open_after_member(tokens, cursor + 1)
    if then_open is None:
        return set(), ()
    then_close = _matching_pairs(tokens, "(", ")").get(then_open)
    if then_close is None:
        return set(), ()
    cursor = then_open + 1
    if cursor < then_close and tokens[cursor].value == "async":
        cursor += 1

    function_callback = cursor < then_close and tokens[cursor].value == "function"
    if function_callback:
        cursor += 1
        if cursor < then_close and tokens[cursor].kind == "identifier":
            cursor += 1

    parameter_tokens: list[Token]
    if cursor < then_close and tokens[cursor].value == "(":
        parameter_close = _matching_pairs(tokens, "(", ")").get(cursor)
        if parameter_close is None or parameter_close >= then_close:
            return set(), ()
        parameter_tokens = tokens[cursor + 1 : parameter_close]
        cursor = parameter_close + 1
    elif cursor < then_close and tokens[cursor].kind == "identifier":
        parameter_tokens = [tokens[cursor]]
        cursor += 1
    else:
        return set(), ()

    if function_callback:
        while cursor < then_close and tokens[cursor].value != "{":
            cursor += 1
        if cursor >= then_close:
            return set(), ()
        body_close = _matching_pairs(tokens, "{", "}").get(cursor)
        if body_close is None:
            return set(), ()
        scope_start = tokens[cursor].end
        scope_end = tokens[body_close].start
    else:
        nesting: list[str] = []
        matching = {")": "(", "]": "[", "}": "{", ">": "<"}
        arrow_index: int | None = None
        while cursor + 1 < then_close:
            value = tokens[cursor].value
            if value in {"(", "[", "{", "<"}:
                nesting.append(value)
            elif value in matching and nesting and nesting[-1] == matching[value]:
                nesting.pop()
            elif (
                not nesting
                and value == "="
                and tokens[cursor + 1].value == ">"
            ):
                arrow_index = cursor
                break
            cursor += 1
        if arrow_index is None or arrow_index + 2 >= then_close:
            return set(), ()
        body_start = arrow_index + 2
        if tokens[body_start].value == "{":
            body_close = _matching_pairs(tokens, "{", "}").get(body_start)
            if body_close is None:
                return set(), ()
            scope_start = tokens[body_start].end
            scope_end = tokens[body_close].start
        else:
            scope_start = tokens[body_start].start
            scope_end = tokens[then_close].start
            expression_nesting: list[str] = []
            matching = {")": "(", "]": "[", "}": "{", ">": "<"}
            for expression_token in tokens[body_start:then_close]:
                if expression_token.value in {"(", "[", "{", "<"}:
                    expression_nesting.append(expression_token.value)
                elif (
                    expression_token.value in matching
                    and expression_nesting
                    and expression_nesting[-1]
                    == matching[expression_token.value]
                ):
                    expression_nesting.pop()
                elif expression_token.value == "," and not expression_nesting:
                    scope_end = expression_token.start
                    break

    parameters = _split_top_level_entries(parameter_tokens)
    if not parameters:
        return set(), ()
    first_parameter = parameters[0]
    imported: set[str] = set()
    local: set[str] = set()
    namespaces: set[str] = set()
    if first_parameter and first_parameter[0].value == "{":
        close_brace = _matching_pairs(first_parameter, "{", "}").get(0)
        if close_brace is None:
            return set(), ()
        imported, local, namespaces = _destructuring_import_facts(
            first_parameter[: close_brace + 1]
        )
    elif first_parameter and first_parameter[0].kind == "identifier":
        local.add(first_parameter[0].value)
        namespaces.add(first_parameter[0].value)
        imported.add("*")

    scoped = tuple(
        ScopedBinding(
            name=name,
            start=scope_start,
            end=scope_end,
            namespace=name in namespaces,
        )
        for name in sorted(local)
    )
    return imported, scoped


def _static_import_facts(
    tokens: list[Token], keyword: str, source_index: int, *, import_equals: bool
) -> tuple[frozenset[str], frozenset[str], frozenset[str]]:
    imported: set[str] = set()
    local: set[str] = set()
    namespaces: set[str] = set()
    clause = tokens[1:source_index]

    if import_equals:
        if clause and clause[0].value == "type":
            clause = clause[1:]
        binding = next(
            (token.value for token in clause if token.kind == "identifier"),
            None,
        )
        if binding is not None:
            imported.add("*")
            local.add(binding)
            namespaces.add(binding)
        return frozenset(imported), frozenset(local), frozenset(namespaces)

    if clause and clause[-1].value == "from":
        clause = clause[:-1]
    declaration_type_only = _is_type_only_tokens(tokens[: source_index + 1], keyword)
    if declaration_type_only and clause and clause[0].value == "type":
        clause = clause[1:]

    if keyword == "export":
        if clause and clause[0].value == "type":
            clause = clause[1:]
        if clause and clause[0].value == "*":
            imported.add("*")
        named_open = next(
            (index for index, token in enumerate(clause) if token.value == "{"),
            None,
        )
        if named_open is not None:
            named_close = max(
                index for index, token in enumerate(clause) if token.value == "}"
            )
            for entry in _split_top_level_entries(
                clause[named_open + 1 : named_close]
            ):
                if entry and entry[0].value == "type" and (
                    len(entry) < 2 or entry[1].value != "as"
                ):
                    entry = entry[1:]
                if entry and entry[0].kind in {"identifier", "string"}:
                    imported.add(entry[0].value)
        return frozenset(imported), frozenset(), frozenset()

    named_open = next(
        (index for index, token in enumerate(clause) if token.value == "{"),
        None,
    )
    prefix_end = named_open if named_open is not None else len(clause)
    prefix = [token for token in clause[:prefix_end] if token.value != ","]
    if prefix and prefix[0].value != "*" and prefix[0].kind == "identifier":
        imported.add("default")
        local.add(prefix[0].value)
    for index, token in enumerate(clause):
        if (
            token.value == "*"
            and index + 2 < len(clause)
            and clause[index + 1].value == "as"
            and clause[index + 2].kind == "identifier"
        ):
            imported.add("*")
            local.add(clause[index + 2].value)
            namespaces.add(clause[index + 2].value)

    if named_open is not None:
        named_close = max(
            index for index, token in enumerate(clause) if token.value == "}"
        )
        for entry in _split_top_level_entries(clause[named_open + 1 : named_close]):
            if entry and entry[0].value == "type" and (
                len(entry) < 2 or entry[1].value != "as"
            ):
                entry = entry[1:]
            if not entry or entry[0].kind not in {"identifier", "string"}:
                continue
            imported.add(entry[0].value)
            as_index = next(
                (
                    index
                    for index, token in enumerate(entry[1:], start=1)
                    if token.value == "as"
                ),
                None,
            )
            if as_index is not None and as_index + 1 < len(entry):
                if entry[as_index + 1].kind == "identifier":
                    local.add(entry[as_index + 1].value)
            elif entry[0].kind == "identifier":
                local.add(entry[0].value)
    return frozenset(imported), frozenset(local), frozenset(namespaces)


def _literal_dynamic_import_source(
    tokens: list[Token], open_index: int, close_index: int
) -> Token | None:
    first_argument: list[Token] = []
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    for token in tokens[open_index + 1 : close_index]:
        if token.value == "," and not nesting:
            break
        first_argument.append(token)
        if token.value in {"(", "[", "{", "<"}:
            nesting.append(token.value)
        elif token.value in matching and nesting and nesting[-1] == matching[token.value]:
            nesting.pop()

    return _literal_asserted_expression_source(first_argument)


def _literal_asserted_expression_source(tokens: list[Token]) -> Token | None:
    """Return the literal underneath grouping and TS-only assertions."""

    while (
        len(tokens) >= 2
        and tokens[0].value == "("
        and tokens[-1].value == ")"
        and _matching_pairs(tokens, "(", ")").get(0) == len(tokens) - 1
    ):
        tokens = tokens[1:-1]
    if len(tokens) == 1 and tokens[0].kind == "string":
        return tokens[0]

    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    for index, token in enumerate(tokens):
        value = token.value
        if value in {"(", "[", "{", "<"}:
            nesting.append(value)
        elif value in matching and nesting and nesting[-1] == matching[value]:
            nesting.pop()
        elif not nesting and value in {"as", "satisfies"}:
            source = _literal_asserted_expression_source(tokens[:index])
            if source is not None and _looks_like_assertion_type(tokens[index + 1 :]):
                return source
            return None
    return None


def _looks_like_assertion_type(tokens: list[Token]) -> bool:
    """Reject runtime continuations after an otherwise transparent assertion."""

    if not tokens:
        return False
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    saw_extends = False
    for index, token in enumerate(tokens):
        value = token.value
        if value in {"(", "[", "{", "<"}:
            nesting.append(value)
            continue
        if value in matching and nesting and nesting[-1] == matching[value]:
            nesting.pop()
            continue
        if nesting:
            continue
        if value == "extends":
            saw_extends = True
        elif value in {",", ";", "+", "-", "*", "/", "%", "instanceof"}:
            return False
        elif value == "=" and not (
            index + 1 < len(tokens) and tokens[index + 1].value == ">"
        ):
            return False
        elif value in {"&", "|", "?"}:
            if (
                index + 1 < len(tokens)
                and tokens[index + 1].value == value
            ):
                return False
            if value == "?" and not saw_extends:
                return False
        elif value in {"in", "await", "delete", "throw", "yield"}:
            return False
    return not nesting


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
        if keyword == "import" and index + 1 < len(tokens) and tokens[index + 1].value == "(":
            close_index = _matching_pairs(tokens, "(", ")").get(index + 1)
            source_token = (
                _literal_dynamic_import_source(tokens, index + 1, close_index)
                if close_index is not None
                else None
            )
            if source_token is not None and close_index is not None:
                type_only = _is_import_type_expression(tokens, index)
                (
                    imported_names,
                    local_bindings,
                    namespace_bindings,
                    scoped_bindings,
                ) = (
                    _dynamic_import_binding_facts(tokens, index)
                )
                if type_only:
                    local_bindings = frozenset()
                    namespace_bindings = frozenset()
                end = tokens[close_index].end
                imports.append(
                    ImportStatement(
                        source=source_token.value,
                        statement=text[token.start:end],
                        lineno=token.lineno,
                        type_only=type_only,
                        imported_names=imported_names,
                        local_bindings=local_bindings,
                        namespace_bindings=namespace_bindings,
                        scoped_bindings=scoped_bindings,
                        start=token.start,
                    )
                )
                # Keep walking the argument/options tokens: nested literal
                # imports are independent dependencies and must also report.
                index += 1
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
        import_equals = False
        if keyword == "import" and index + 1 < len(tokens) and tokens[index + 1].kind == "string":
            source_index = index + 1
        else:
            if keyword == "import":
                equals_cursor = index + 1
                if (
                    equals_cursor < len(tokens)
                    and tokens[equals_cursor].value == "type"
                ):
                    equals_cursor += 1
                if (
                    equals_cursor + 4 < len(tokens)
                    and tokens[equals_cursor].kind == "identifier"
                    and tokens[equals_cursor + 1].value == "="
                    and tokens[equals_cursor + 2].value == "require"
                    and tokens[equals_cursor + 3].value == "("
                    and tokens[equals_cursor + 4].kind == "string"
                ):
                    source_index = equals_cursor + 4
                    import_equals = True
            cursor = index + 1
            while source_index is None and cursor < len(tokens):
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

        end = _statement_end(
            tokens, source_index, import_equals=import_equals
        )
        statement_tokens = tokens[index : source_index + 1]
        imported_names, local_bindings, namespace_bindings = _static_import_facts(
            statement_tokens,
            keyword,
            source_index - index,
            import_equals=import_equals,
        )
        imports.append(
            ImportStatement(
                source=tokens[source_index].value,
                statement=text[token.start:end],
                lineno=token.lineno,
                type_only=_is_type_only_tokens(statement_tokens, keyword),
                imported_names=imported_names,
                local_bindings=local_bindings,
                namespace_bindings=namespace_bindings,
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
