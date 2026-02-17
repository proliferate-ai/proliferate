/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: ["class"],
	content: [
		"./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
		"./src/components/**/*.{js,ts,jsx,tsx,mdx}",
		"./src/app/**/*.{js,ts,jsx,tsx,mdx}",
	],
	theme: {
		extend: {
			fontFamily: {
				sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
				mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
			},
			fontSize: {
				xs: ["12px", "16px"],
				sm: ["13px", "20px"],
				base: ["14px", "24px"],
				lg: ["16px", "24px"],
				xl: ["18px", "28px"],
			},
			colors: {
				border: "hsl(var(--border))",
				input: "hsl(var(--input))",
				ring: "hsl(var(--ring))",
				background: "hsl(var(--background))",
				foreground: "hsl(var(--foreground))",
				primary: {
					DEFAULT: "hsl(var(--primary))",
					foreground: "hsl(var(--primary-foreground))",
				},
				secondary: {
					DEFAULT: "hsl(var(--secondary))",
					foreground: "hsl(var(--secondary-foreground))",
				},
				destructive: {
					DEFAULT: "hsl(var(--destructive))",
					foreground: "hsl(var(--destructive-foreground))",
				},
				muted: {
					DEFAULT: "hsl(var(--muted))",
					foreground: "hsl(var(--muted-foreground))",
				},
				accent: {
					DEFAULT: "hsl(var(--accent))",
					foreground: "hsl(var(--accent-foreground))",
				},
				popover: {
					DEFAULT: "hsl(var(--popover))",
					foreground: "hsl(var(--popover-foreground))",
				},
				card: {
					DEFAULT: "hsl(var(--card))",
					foreground: "hsl(var(--card-foreground))",
				},
				sidebar: {
					DEFAULT: "hsl(var(--sidebar))",
					foreground: "hsl(var(--sidebar-foreground))",
					border: "hsl(var(--sidebar-border))",
				},
				"chat-input": "hsl(var(--chat-input))",
			},
			boxShadow: {
				subtle: "rgba(0, 0, 0, 0.04) 0px 1px 2px",
				keystone: "rgba(0, 0, 0, 0.04) 0px 3px 3px, rgba(0, 0, 0, 0.05) 0px 1px 2px",
				floating: "0 0 0 1px rgba(0,0,0,0.05), 0 8px 24px -4px rgba(0,0,0,0.1)",
				"floating-dark": "0 0 0 1px rgba(255,255,255,0.1), 0 8px 24px -4px rgba(0,0,0,0.5)",
			},
			borderRadius: {
				xl: "calc(var(--radius) + 4px)",
				lg: "var(--radius)",
				md: "calc(var(--radius) - 2px)",
				sm: "calc(var(--radius) - 4px)",
			},
			keyframes: {
				"accordion-down": {
					from: { height: "0" },
					to: { height: "var(--radix-accordion-content-height)" },
				},
				"accordion-up": {
					from: { height: "var(--radix-accordion-content-height)" },
					to: { height: "0" },
				},
				"bounce-dot": {
					"0%, 100%": { transform: "translateY(0)" },
					"50%": { transform: "translateY(-50%)" },
				},
			},
			animation: {
				"accordion-down": "accordion-down 0.2s ease-out",
				"accordion-up": "accordion-up 0.2s ease-out",
				"bounce-dot": "bounce-dot 0.6s ease-in-out infinite",
			},
		},
	},
	plugins: [require("tailwindcss-animate")],
};
