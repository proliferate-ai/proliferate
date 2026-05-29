const ORGANIZATION_LOGO_IMAGE_MAX_BYTES = 256 * 1024;

const ORGANIZATION_LOGO_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function organizationLogoImageValidationError(file: {
  size: number;
  type: string;
}): string | null {
  if (!ORGANIZATION_LOGO_IMAGE_TYPES.has(file.type)) {
    return "Use a PNG, JPEG, WebP, or GIF image.";
  }
  if (file.size > ORGANIZATION_LOGO_IMAGE_MAX_BYTES) {
    return "Use an image 256 KB or smaller.";
  }
  return null;
}
