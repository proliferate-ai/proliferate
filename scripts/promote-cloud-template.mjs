#!/usr/bin/env node

import { Template } from "e2b";

function printUsage() {
  console.log(`Assign rolling tags to an existing E2B template build.

Usage:
  node scripts/promote-cloud-template.mjs --name <template-family> --source-tag <tag> --tag <target-tag>

Options:
  --name <template-family>  Template family name or public family ref.
  --source-tag <tag>        Existing immutable source tag, e.g. sha-abc1234.
  --tag <target-tag>        Target tag to assign. Repeatable.
  --help                    Show this help text.
`);
}

function parseArgs(argv) {
  let name = "";
  let sourceTag = "";
  const targetTags = [];
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--name":
        name = argv[i + 1] || "";
        i += 1;
        break;
      case "--source-tag":
        sourceTag = argv[i + 1] || "";
        i += 1;
        break;
      case "--tag":
        targetTags.push(argv[i + 1] || "");
        i += 1;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!help) {
    if (!name) {
      throw new Error("--name is required.");
    }
    if (!sourceTag) {
      throw new Error("--source-tag is required.");
    }
    if (targetTags.length === 0) {
      throw new Error("At least one --tag is required.");
    }
  }

  return {
    name,
    sourceTag,
    targetTags: [...new Set(targetTags)],
    help,
  };
}

function normalizeTemplateName(input) {
  const family = input.trim().split(":")[0];
  return family.split("/").at(-1) || family;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    console.error("");
    printUsage();
    process.exit(1);
  }

  if (parsed.help) {
    printUsage();
    return;
  }

  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) {
    throw new Error("E2B_API_KEY environment variable is required.");
  }

  const templateName = normalizeTemplateName(parsed.name);
  const tags = await Template.getTags(templateName, { apiKey });
  if (!tags.some((tag) => tag.tag === parsed.sourceTag)) {
    throw new Error(`Source tag ${parsed.sourceTag} does not exist on ${templateName}.`);
  }

  const sourceRef = `${templateName}:${parsed.sourceTag}`;
  const result = await Template.assignTags(sourceRef, parsed.targetTags, { apiKey });

  console.log(`Promoted ${sourceRef} -> ${result.tags.join(", ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
