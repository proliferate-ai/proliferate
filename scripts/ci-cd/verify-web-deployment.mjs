import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

function normalizeHttpUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return url.toString().replace(/\/+$/, "");
}

async function fetchOk(fetchImpl, url, label, headers = undefined) {
  let response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} was unreachable at ${url}: ${detail}`);
  }
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status} at ${url}`);
  }
  return response;
}

function scriptSources(html) {
  const sources = [];
  const pattern = /<script\b[^>]*\bsrc=(["'])([^"']+)\1[^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    sources.push(match[2]);
  }
  return [...new Set(sources)];
}

export async function verifyWebDeployment({
  webUrl,
  apiBaseUrl,
  fetchImpl = globalThis.fetch,
}) {
  const normalizedWebUrl = normalizeHttpUrl(webUrl, "webUrl");
  const normalizedApiBaseUrl = normalizeHttpUrl(apiBaseUrl, "apiBaseUrl");
  const healthUrl = `${normalizedApiBaseUrl}/health`;

  await fetchOk(fetchImpl, healthUrl, "API health", {
    Accept: "application/json",
  });

  const htmlResponse = await fetchOk(
    fetchImpl,
    normalizedWebUrl,
    "candidate Web",
    { Accept: "text/html" },
  );
  const html = await htmlResponse.text();
  const sources = scriptSources(html);
  if (sources.length === 0) {
    throw new Error(`candidate Web exposed no script assets at ${normalizedWebUrl}`);
  }

  const checkedAssets = [];
  for (const source of sources) {
    const assetUrl = new URL(source, `${normalizedWebUrl}/`).toString();
    const assetResponse = await fetchOk(
      fetchImpl,
      assetUrl,
      "candidate Web script",
    );
    const sourceText = await assetResponse.text();
    checkedAssets.push(assetUrl);
    if (sourceText.includes(normalizedApiBaseUrl)) {
      return {
        apiBaseUrl: normalizedApiBaseUrl,
        healthUrl,
        webUrl: normalizedWebUrl,
        matchedAssetUrl: assetUrl,
      };
    }
  }

  throw new Error(
    `candidate Web did not bake the expected API base ${normalizedApiBaseUrl} `
      + `into ${checkedAssets.length} script asset(s)`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      "api-base-url": { type: "string" },
      "web-url": { type: "string" },
    },
    strict: true,
  });
  if (!values["web-url"] || !values["api-base-url"]) {
    throw new Error("--web-url and --api-base-url are required");
  }

  const receipt = await verifyWebDeployment({
    webUrl: values["web-url"],
    apiBaseUrl: values["api-base-url"],
  });
  console.log(
    `Verified candidate Web ${receipt.webUrl} against ${receipt.healthUrl}; `
      + `API base found in ${receipt.matchedAssetUrl}`,
  );
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
