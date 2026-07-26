# Taxonomy batch progress (working file — deleted in final commit)

Plan: moves.tsv (37 moves; unlisted files stay). Infra allowlist (stay at src root): lib/, utils/, overlays/, css/test-setup if present.

Judgment calls (JC):
- kit/Checkbox + kit/Tooltip collide with styled primitives namesakes → checkbox-primitive.tsx / tooltip-primitive.tsx (raw layer, lowercase module style); ruled future merge collapses them.
- kit/Command → primitives (raw cmdk wrapper); CommandPalette (composition) → patterns.
- FixedPositionLayer, RowActionIconButton, PopoverSearchField → primitives (low-level building blocks; PopoverSearchField not moved, already in primitives).
- AuthProviderButton, ListRow, EmptyState → patterns (compositions).
- AnimatedSwapText/AnimatedCollapsibleContent stay primitives; ThinkingText → patterns per catalog table.
- icons.tsx barrel → icons/index.tsx.

Steps:
- [x] 1. Plan committed
- [x] 2. git mv per moves.tsv (pure renames, no content edits)
- [ ] 3. ui-internal wiring: relative imports, exports map, tsup/tsconfig/vitest paths; ui builds green
- [ ] 4. external consumers: product-ui/product-surfaces/product-client/apps rewrites + tailwind @source globs; shared:typecheck green
- [ ] 5. specs/ links + appearance-baseline key renames; check_docs + appearance + boundaries green
- [ ] 6. product-ui patterns/ grouping (M2)
- [ ] 7. boundary gate rules (G)
- [ ] 8. component-library.md spec (D)
- [ ] 9. adversarial verify + fixes (V)
- [ ] 10. delete .taxonomy-plan, final gates
