import { transform } from "sucrase";

export function transformJsxSource(source: string): string {
  return transform(source, {
    transforms: ["jsx", "typescript", "imports"],
  }).code;
}
