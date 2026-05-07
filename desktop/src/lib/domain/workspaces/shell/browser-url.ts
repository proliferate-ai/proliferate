const MAX_BROWSER_URL_LENGTH = 4096;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const UNSUPPORTED_SCHEME_PATTERN = /^(?:javascript|data|file|ftp|blob|about):/i;
const EXPLICIT_SCHEME_PATTERN = /^[A-Za-z][A-Za-z\d+.-]*:\/\//;
const HTTP_SCHEME_PATTERN = /^https?:\/\//i;

export function normalizeBrowserUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_BROWSER_URL_LENGTH || CONTROL_CHARACTER_PATTERN.test(input)) {
    return null;
  }
  if (UNSUPPORTED_SCHEME_PATTERN.test(trimmed)) {
    return null;
  }

  const parsed = parseBrowserUrl(trimmed);
  if (!parsed) {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  if (parsed.port) {
    const port = Number.parseInt(parsed.port, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
  }

  if (parsed.hostname === "0.0.0.0") {
    parsed.hostname = "localhost";
  }

  return parsed.href.length <= MAX_BROWSER_URL_LENGTH ? parsed.href : null;
}

export function browserIframeSandbox(url: string, appOrigin: string): string {
  const base = "allow-scripts allow-forms";
  try {
    const parsed = new URL(url);
    if (isLocalOrPrivateHost(parsed.hostname) && parsed.origin !== appOrigin) {
      return `${base} allow-same-origin`;
    }
  } catch {
    return base;
  }
  return base;
}

function parseBrowserUrl(input: string): URL | null {
  if (HTTP_SCHEME_PATTERN.test(input)) {
    return parseUrl(input);
  }
  if (EXPLICIT_SCHEME_PATTERN.test(input)) {
    return null;
  }
  if (/^\d+$/.test(input)) {
    const port = Number.parseInt(input, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    return parseUrl(`http://localhost:${port}`);
  }

  const provisional = parseUrl(`http://${input}`);
  if (!provisional) {
    return null;
  }
  const protocol = isLocalOrPrivateHost(provisional.hostname) ? "http:" : "https:";
  provisional.protocol = protocol;
  return provisional;
}

function parseUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") {
    return true;
  }
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }

  const parts = host.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((octet, index) => !Number.isInteger(octet) || octet < 0 || octet > 255 || String(octet) !== parts[index])) {
    return false;
  }
  const [first, second] = octets;
  if (first === 0 && second === 0) {
    return true;
  }
  if (first === 10 || first === 127 || first === 169 && second === 254) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }
  return first === 192 && second === 168;
}
