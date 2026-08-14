const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface FilteredRendererDiagnosticText {
  value: string;
  structural: boolean;
}

export function filterRendererDiagnosticText(
  input: string,
  limit: number,
): FilteredRendererDiagnosticText {
  let structural = false;
  const boundedWorkCharacters = limit + 512;
  const workTruncated = input.length > boundedWorkCharacters;
  let value = workTruncated
    ? input.slice(0, boundedWorkCharacters)
    : input;
  if (workTruncated) {
    structural = true;
  }
  const replacements: Array<[RegExp, string]> = [
    [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]"],
    [/(\b(?:[A-Za-z0-9]+_)*(?:TOKEN|API_?KEY|KEY|SECRET|PASSWORD|PASSPHRASE)=)[^\s]+/gi, "$1[REDACTED]"],
    [/([?&](?:access_token|refresh_token|id_token|token|api_key|key|secret|signature|sig|password|x-amz-signature|x-amz-credential|x-amz-security-token|x-goog-signature)=)[^&#\s]+/gi, "$1[REDACTED]"],
    [/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED]"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*$/g, "[REDACTED]"],
    [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g, "[REDACTED]"],
  ];
  for (const [pattern, replacement] of replacements) {
    const next = value.replace(pattern, replacement);
    if (next !== value) {
      structural = true;
      value = next;
    }
  }
  if (workTruncated) {
    // The artificial work boundary can hide a terminator that a complete
    // credential pattern relies on (notably URL userinfo's `@`) or cut a
    // fixed-minimum token before it reaches that minimum. Treat only the
    // ambiguous trailing candidate as secret; complete short strings retain
    // the ordinary matching behavior above.
    const trailingPatterns: Array<[RegExp, string]> = [
      [/(https?:\/\/)[^\s/@:]+:[^\s/@]*$/gi, "$1[REDACTED]"],
      [/\b(?:gh[pousr]_|AKIA|sk-|eyJ)[A-Za-z0-9._-]*$/g, "[REDACTED]"],
    ];
    for (const [pattern, replacement] of trailingPatterns) {
      const next = value.replace(pattern, replacement);
      if (next !== value) {
        structural = true;
        value = next;
      }
    }
  }
  const bytes = textEncoder.encode(value);
  if (bytes.byteLength <= limit) {
    if (value.length === 0) {
      return { value: "[empty]", structural: true };
    }
    return { value, structural };
  }
  const suffix = "[truncated]";
  const suffixBytes = textEncoder.encode(suffix).byteLength;
  let prefix = textDecoder.decode(bytes.slice(0, Math.max(0, limit - suffixBytes)));
  while (textEncoder.encode(prefix).byteLength + suffixBytes > limit) {
    prefix = prefix.slice(0, -1);
  }
  return { value: `${prefix}${suffix}`, structural: true };
}
