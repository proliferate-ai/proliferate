import { CodeTokenLine } from "@proliferate/ui";

// CodeTokenLine is a leaf: it renders ONE line of shiki tokens as coloured
// spans and nothing else — no gutter, no block box, no surface. Every cell
// below therefore composes it the way its real parent
// (CodeBlockTokenContent) does: a code surface, a line-number gutter, and
// one CodeTokenLine per row.

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

function tokenizeLine(line: string, commentPrefix = "//") {
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

const PARSE_SOURCE = [
  "export function parseLoopWire(value: unknown): LoopWire | null {",
  "  if (typeof value !== \"object\" || value === null) {",
  "    return null; // a malformed mirror must read as \"no loop\"",
  "  }",
  "  const record = value as Record<string, unknown>;",
  "  const schedule = parseLoopSchedule(record.schedule);",
  "  return schedule ? { ...record, schedule } : null;",
  "}",
];

const SURFACE =
  "w-full max-w-2xl overflow-x-auto rounded-lg bg-code-block-background p-3";

export const GutteredLines = () => (
  <div className={SURFACE}>
    <table className="border-collapse font-mono text-chat">
      <tbody>
        {PARSE_SOURCE.map((line, index) => (
          <tr key={index}>
            <td className="select-none px-3 align-top text-right text-readable-code tabular-nums text-faint">
              {58 + index}
            </td>
            <td className="py-px pr-3 align-top">
              <CodeTokenLine
                tokens={tokenizeLine(line)}
                lineIndex={index}
                className="whitespace-pre font-mono text-foreground"
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const SingleLine = () => (
  <div className={SURFACE}>
    <div className="whitespace-pre font-mono text-chat text-foreground">
      <CodeTokenLine
        tokens={tokenizeLine(
          'const nextFireAtMs = loopNextFireAtMs(loop, nowMs); // 5m cadence',
        )}
        lineIndex={0}
      />
    </div>
  </div>
);

export const SearchMarkedLine = () => (
  <div className={SURFACE}>
    <div className="whitespace-pre font-mono text-chat text-foreground">
      <CodeTokenLine
        tokens={tokenizeLine(
          '  const schedule = parseLoopSchedule(record.schedule);',
        )}
        lineIndex={0}
        renderToken={(text, tokenIndex) => {
          if (!text.includes("schedule")) return text;
          const parts = text.split("schedule");
          // The transcript's real find-match paint (product.css owns
          // `mark.codex-thread-find-match`).
          return parts.flatMap((part, index) =>
            index === 0
              ? [part]
              : [
                <mark key={`${tokenIndex}-${index}`} className="codex-thread-find-match">
                  schedule
                </mark>,
                part,
              ],
          );
        }}
      />
    </div>
  </div>
);
