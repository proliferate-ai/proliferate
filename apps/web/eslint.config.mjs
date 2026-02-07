import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";

/**
 * ESLint config for code quality rules that Biome doesn't cover.
 * - max-lines: Keep files under 300 lines (forces splitting by concern)
 * - max-lines-per-function: Keep functions under 100 lines (prevents giant useEffects)
 * - react/forbid-elements: Enforce component usage over raw HTML
 */
export default [
	// File and function length limits (all TS/TSX files)
	{
		files: ["src/**/*.ts", "src/**/*.tsx"],
		languageOptions: {
			parser: tsParser,
		},
		rules: {
			"max-lines": ["warn", { max: 300, skipBlankLines: true, skipComments: true }],
			"max-lines-per-function": [
				"warn",
				{ max: 100, skipBlankLines: true, skipComments: true, IIFEs: true },
			],
		},
	},
	// React-specific rules (TSX only, exclude UI primitives)
	{
		files: ["src/**/*.tsx"],
		ignores: ["src/components/**"],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaFeatures: {
					jsx: true,
				},
			},
		},
		plugins: {
			react: reactPlugin,
		},
		rules: {
			"react/forbid-elements": [
				"error",
				{
					forbid: [
						{
							element: "button",
							message: "Use <Button> from @/components/ui/button instead of raw <button>",
						},
						{
							element: "input",
							message: "Use <Input> from @/components/ui/input instead of raw <input>",
						},
						{
							element: "label",
							message: "Use <Label> from @/components/ui/label instead of raw <label>",
						},
						{
							element: "select",
							message: "Use <Select> from @/components/ui/select instead of raw <select>",
						},
						{
							element: "textarea",
							message: "Use <Textarea> from @/components/ui/textarea instead of raw <textarea>",
						},
					],
				},
			],
		},
		settings: {
			react: {
				version: "detect",
			},
		},
	},
];
