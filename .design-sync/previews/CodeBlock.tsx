import { CodeBlock } from "@proliferate/ui";

// Token colours are the shipped `proliferate-dark` code palette
// (design/tokens.ts → codeColors.dark), the same values shiki hands
// CodeBlock at runtime.
const CODE = {
  keyword: "#2E95D3",
  string: "#00A67D",
  emphasis: "#DF3079",
  support: "#E9950C",
  heading: "#F22C3D",
  muted: "#FFFFFF80",
  foreground: "#FFFFFF",
};

const KEYWORDS = new Set([
  "export", "function", "const", "let", "return", "if", "else", "switch",
  "case", "default", "import", "from", "type", "interface", "await", "async",
  "new", "for", "in", "of", "class", "def", "with", "not", "yield", "None",
  "True", "False", "null", "undefined", "void", "throw", "try", "catch",
]);

const BUILTINS = new Set([
  "console", "Math", "JSON", "Promise", "Object", "Array", "String", "Number",
  "self", "print", "len", "dict", "list", "str", "int", "pool", "window",
]);

function classify(word: string, rest: string) {
  if (KEYWORDS.has(word)) return CODE.keyword;
  if (BUILTINS.has(word)) return CODE.support;
  if (/^\s*\(/.test(rest)) return CODE.heading;
  if (/^[A-Z]/.test(word)) return CODE.emphasis;
  return CODE.foreground;
}

const TOKEN_RE =
  /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)|(\s+)|([^\s])/g;

function tokenizeLine(line: string, commentPrefix: string) {
  const tokens: { content: string; color?: string }[] = [];
  const quote = line.search(/["'`]/);
  const found = line.indexOf(commentPrefix);
  const commentAt = found >= 0 && (quote < 0 || found < quote) ? found : -1;
  const code = commentAt >= 0 ? line.slice(0, commentAt) : line;
  const comment = commentAt >= 0 ? line.slice(commentAt) : "";

  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(code)) !== null) {
    const [text, str, num, word, space] = match;
    if (str) tokens.push({ content: text, color: CODE.string });
    else if (num) tokens.push({ content: text, color: CODE.emphasis });
    else if (word) {
      tokens.push({
        content: text,
        color: classify(word, code.slice(match.index + text.length)),
      });
    } else if (space) tokens.push({ content: text });
    else tokens.push({ content: text, color: CODE.foreground });
  }
  if (comment) tokens.push({ content: comment, color: CODE.muted });
  return tokens;
}

function tokenize(code: string, commentPrefix = "//") {
  return code.split("\n").map((line) => tokenizeLine(line, commentPrefix));
}

const TS_SOURCE = `export function deriveGoalBarState(goal: GoalWire | null): GoalBarState {
  if (!goal || goal.status === "cleared" || goal.status === "met") {
    return { kind: "hidden" };
  }
  switch (goal.status) {
    case "active":
      return { kind: "live", phase: "pursuing", goal };
    case "paused":
      return { kind: "live", phase: "paused", goal };
    default:
      // Blocked and failed become the sticky result row.
      return { kind: "result", outcome: "blocked", goal };
  }
}`;

const PY_SOURCE = `async def stream_session_events(session_id: str) -> AsyncIterator[Event]:
    """Replay stored turns, then follow the live tail."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(REPLAY_SQL, session_id)
    for row in rows:
        yield Event.model_validate_json(row["payload"])`;

const SHELL_SOURCE = `$ cargo run --bin anyharness -- serve --profile design-sync
   Compiling anyharness-core v0.4.2 (/home/pablo/proliferate/anyharness)
    Finished dev [unoptimized + debuginfo] target(s) in 41.20s
     Running \`target/debug/anyharness serve --profile design-sync\`
anyharness listening on 127.0.0.1:8730 (workspace proliferate/proliferate)`;

export const TypeScriptHighlighted = () => (
  <div className="w-full max-w-2xl">
    <CodeBlock
      code={TS_SOURCE}
      label="typescript"
      tokens={tokenize(TS_SOURCE)}
      showLineNumbers
    />
  </div>
);

export const PythonWithLineNumbers = () => (
  <div className="w-full max-w-2xl">
    <CodeBlock
      code={PY_SOURCE}
      label="server/app/sessions/stream.py"
      tokens={tokenize(PY_SOURCE, "#")}
      showLineNumbers
      lineNumberStart={142}
    />
  </div>
);

export const PlainTextFallback = () => (
  <div className="w-full max-w-2xl">
    <CodeBlock code={SHELL_SOURCE} label="bash" />
  </div>
);

// One-line token payload, no gutter — the only shape the ungutted token path
// renders correctly (see .design-sync/learnings/G.md: multi-line token
// content needs `showLineNumbers`, or every line concatenates).
export const SingleLineNoLabel = () => (
  <div className="w-full max-w-2xl">
    <CodeBlock
      code={'pnpm -F "@proliferate/product-ui..." build'}
      tokens={tokenize('pnpm -F "@proliferate/product-ui..." build', "#")}
    />
  </div>
);
