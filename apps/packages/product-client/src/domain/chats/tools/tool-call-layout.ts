export const TOOL_CALL_BODY_MAX_HEIGHT_CLASS = "max-h-[224px]";

// Rung 8 (PRO-187, PRO-225): fenced code blocks in transcript prose are not
// behind a disclosure toggle the way tool-output rows are, so a taller cap
// keeps ordinary code readable while still bounding a pathologically long
// block to a nested, internally-scrolled region rather than displacing
// unbounded transcript height. Chaining (rung 8) makes wheel/touch/momentum
// continue into the transcript once this region is exhausted.
export const CODE_BLOCK_MAX_HEIGHT_CLASS = "max-h-[420px]";
