# Hugging Face datasets

Use this skill to inspect Hugging Face datasets through the mounted MCP server.

1. Resolve the dataset repo id and optional subset, split, search term, or row range.
2. Fetch metadata before rows: subsets, splits, features, sizes, and viewer availability.
3. Page through rows deliberately. Do not assume a small sample represents the whole dataset.
4. Preserve dataset ids, config names, split names, row offsets, and source URLs.
5. Avoid upload, delete, or write operations unless the user explicitly asks and the mounted tools support them.
