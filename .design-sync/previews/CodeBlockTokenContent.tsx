import { CodeBlockTokenContent } from "@proliferate/ui";

// Token colours are the shipped `proliferate-dark` code palette
// (design/tokens.ts → codeColors.dark), the same values shiki hands the
// token renderers at runtime.
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

const RESOLVER_SOURCE = `export function resolveTranscriptBottomInsets(
  bottomInsetPx: number,
  nonDisplacingBottomInsetPx: number,
): { structural: number; nonDisplacing: number } {
  const total = Math.max(0, bottomInsetPx);
  const nonDisplacing = Math.min(total, Math.max(0, nonDisplacingBottomInsetPx));
  return { structural: total - nonDisplacing, nonDisplacing };
}`;

const LOOP_SOURCE = `const armedLoops = input.loops.filter((loop) => loop.status === "active");
if (armedLoops.length > 0) {
  chips.push({
    kind: "loops",
    count: armedLoops.length,
    liveCount: armedLoops.length,
    label: pluralize(armedLoops.length, "loop"),
  });
}`;

// The content area CodeBlock puts around this renderer, reproduced so the
// cell shows the tokens on the surface they ship on.
const SURFACE =
  "w-full max-w-2xl overflow-x-auto rounded-lg bg-code-block-background p-3 font-mono text-chat";

export const LineNumberedSource = () => (
  <div className={SURFACE}>
    <CodeBlockTokenContent
      lines={tokenize(RESOLVER_SOURCE)}
      showLineNumbers
      lineNumberStart={59}
      className="text-chat text-foreground"
    />
  </div>
);

// No gutter: the token lines are emitted as bare inline spans, so this path
// is only correct for a ONE-line payload (see .design-sync/learnings/G.md).
export const SingleLineNoGutter = () => (
  <div className={SURFACE}>
    <CodeBlockTokenContent
      lines={tokenize('const armedLoops = loops.filter((loop) => loop.status === "active");')}
      className="text-chat text-foreground"
    />
  </div>
);

export const SearchHighlightOverlay = () => (
  <div className={SURFACE}>
    <CodeBlockTokenContent
      lines={tokenize(LOOP_SOURCE)}
      showLineNumbers
      lineNumberStart={1}
      className="text-chat text-foreground"
      renderToken={(text) => {
        const parts = text.split("armedLoops");
        if (parts.length === 1) return text;
        // The transcript's real find-match paint (product.css owns
        // `mark.codex-thread-find-match`).
        return parts.flatMap((part, index) =>
          index === 0
            ? [part]
            : [
              <mark key={index} className="codex-thread-find-match">
                armedLoops
              </mark>,
              part,
            ],
        );
      }}
    />
  </div>
);
