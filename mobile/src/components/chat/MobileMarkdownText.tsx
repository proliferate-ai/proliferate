import { Fragment, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "../../styles/tokens";

interface MobileMarkdownTextProps {
  content: string;
}

type MarkdownBlock =
  | { kind: "code"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "paragraph"; text: string };

export function MobileMarkdownText({ content }: MobileMarkdownTextProps) {
  const blocks = parseMarkdownBlocks(content);
  return (
    <View style={styles.root}>
      {blocks.map((block, index) => renderBlock(block, index))}
    </View>
  );
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  switch (block.kind) {
    case "code":
      return (
        <Text key={index} style={styles.codeBlock}>
          {block.text}
        </Text>
      );
    case "heading":
      return (
        <Text
          key={index}
          style={[
            styles.paragraph,
            block.level === 1 ? styles.headingOne : styles.heading,
          ]}
        >
          {renderInlineMarkdown(block.text)}
        </Text>
      );
    case "list":
      return (
        <View key={index} style={styles.list}>
          {block.items.map((item, itemIndex) => (
            <View key={`${index}:${itemIndex}`} style={styles.listItem}>
              <Text style={styles.listMarker}>
                {block.ordered ? `${itemIndex + 1}.` : "-"}
              </Text>
              <Text style={[styles.paragraph, styles.listText]}>
                {renderInlineMarkdown(item)}
              </Text>
            </View>
          ))}
        </View>
      );
    case "paragraph":
    default:
      return (
        <Text key={index} style={styles.paragraph}>
          {renderInlineMarkdown(block.text)}
        </Text>
      );
  }
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ kind: "code", text: codeLines.join("\n") });
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      index += 1;
      continue;
    }

    const listStart = parseListLine(line);
    if (listStart) {
      const items: string[] = [];
      const ordered = listStart.ordered;
      while (index < lines.length) {
        const parsed = parseListLine(lines[index]);
        if (!parsed || parsed.ordered !== ordered) {
          break;
        }
        items.push(parsed.text);
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (
        !current.trim()
        || current.trimStart().startsWith("```")
        || /^(#{1,3})\s+/.test(current.trim())
        || parseListLine(current)
      ) {
        break;
      }
      paragraphLines.push(current.trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function parseListLine(line: string): { ordered: boolean; text: string } | null {
  const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
  if (unordered) {
    return { ordered: false, text: unordered[1] };
  }
  const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
  if (ordered) {
    return { ordered: true, text: ordered[1] };
  }
  return null;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }
    const token = match[0];
    const key = `${match.index}:${token.length}`;
    if (token.startsWith("`")) {
      nodes.push(
        <Text key={key} style={styles.inlineCode}>
          {token.slice(1, -1)}
        </Text>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <Text key={key} style={styles.bold}>
          {token.slice(2, -2)}
        </Text>,
      );
    } else {
      nodes.push(
        <Text key={key} style={styles.italic}>
          {token.slice(1, -1)}
        </Text>,
      );
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes.map((node, index) => (
    <Fragment key={typeof node === "string" ? `${index}:${node}` : index}>
      {node}
    </Fragment>
  ));
}

const styles = StyleSheet.create({
  root: {
    gap: spacing[2],
  },
  paragraph: {
    color: colors.fg,
    fontSize: 15,
    lineHeight: 22,
  },
  headingOne: {
    fontSize: 17,
    fontWeight: "700",
  },
  heading: {
    fontWeight: "700",
  },
  bold: {
    fontWeight: "700",
  },
  italic: {
    fontStyle: "italic",
  },
  inlineCode: {
    borderRadius: 5,
    backgroundColor: colors.card,
    color: colors.fg,
    fontFamily: "monospace",
    fontSize: 14,
  },
  codeBlock: {
    borderRadius: radius.md,
    backgroundColor: colors.card,
    color: colors.fg,
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  list: {
    gap: spacing[1],
  },
  listItem: {
    flexDirection: "row",
    gap: spacing[2],
    alignItems: "flex-start",
  },
  listMarker: {
    minWidth: 12,
    color: colors.fg,
    fontSize: 15,
    lineHeight: 22,
  },
  listText: {
    flex: 1,
    minWidth: 0,
  },
});
