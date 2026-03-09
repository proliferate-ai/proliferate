/** JSON Schema helpers for Pi tool parameter definitions. */

export const Str = (d: string) => ({ type: "string" as const, description: d });

export const OptStr = (d: string) =>
	({ type: "string" as const, description: d, nullable: true }) as const;

export const OptNum = (d: string) =>
	({ type: "number" as const, description: d, nullable: true }) as const;

export const EmptyObj = {
	type: "object" as const,
	properties: {},
	required: [] as string[],
};

export function Obj(props: Record<string, unknown>, required?: string[]) {
	return {
		type: "object" as const,
		properties: props,
		...(required ? { required } : {}),
	};
}
