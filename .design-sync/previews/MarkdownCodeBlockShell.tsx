import { CodeBlockTokenContent, MarkdownCodeBlockShell } from "@proliferate/ui";

// Token colours are the shipped `proliferate-dark` code palette
// (design/tokens.ts → codeColors.dark).
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

const SHELL_SOURCE = `make setup PROFILE=design-sync
make build
make run PROFILE=design-sync   # serves the desktop shell on :1420`;

const TS_SOURCE = `const chips = deriveActivityChips({
  loops: session.loops,
  processes: session.processes,
  agents: session.subagents,
});`;

const SQL_SOURCE = `SELECT turn_id, started_seq, payload
FROM session_turns
WHERE session_id = $1 AND started_seq > $2
ORDER BY started_seq ASC
LIMIT 200;`;

export const ShellCommands = () => (
  <div className="w-full max-w-2xl">
    <MarkdownCodeBlockShell code={SHELL_SOURCE} label="bash" />
  </div>
);

export const HighlightedChildren = () => (
  <div className="w-full max-w-2xl">
    <MarkdownCodeBlockShell code={TS_SOURCE} label="tsx">
      <CodeBlockTokenContent
        lines={tokenize(TS_SOURCE)}
        showLineNumbers
        lineNumberStart={1}
        className="text-chat text-foreground"
      />
    </MarkdownCodeBlockShell>
  </div>
);

export const NoLanguageLabel = () => (
  <div className="w-full max-w-2xl">
    <MarkdownCodeBlockShell code={SQL_SOURCE} />
  </div>
);
