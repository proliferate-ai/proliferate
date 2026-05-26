#!/usr/bin/env node

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

function usage() {
  console.error(`Usage:
  node scripts/dev-public-tunnel-mux.mjs --listen-port <port> --api-base-url <url> --bifrost-base-url <url>`);
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--listen-port") {
      options.listenPort = argv[++i];
    } else if (arg === "--api-base-url") {
      options.apiBaseUrl = argv[++i];
    } else if (arg === "--bifrost-base-url") {
      options.bifrostBaseUrl = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.listenPort || !/^\d+$/.test(String(options.listenPort))) {
    throw new Error("--listen-port must be a TCP port number.");
  }
  if (!options.apiBaseUrl) {
    throw new Error("--api-base-url is required.");
  }
  if (!options.bifrostBaseUrl) {
    throw new Error("--bifrost-base-url is required.");
  }

  return {
    listenPort: Number(options.listenPort),
    apiBaseUrl: normalizeBaseUrl(options.apiBaseUrl),
    bifrostBaseUrl: normalizeBaseUrl(options.bifrostBaseUrl),
  };
}

function normalizeBaseUrl(value) {
  const parsed = new URL(value);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function targetBaseForPath(pathname, options) {
  if (
    pathname === "/anthropic"
    || pathname.startsWith("/anthropic/")
    || pathname === "/openai"
    || pathname.startsWith("/openai/")
    || pathname === "/genai"
    || pathname.startsWith("/genai/")
  ) {
    return options.bifrostBaseUrl;
  }
  return options.apiBaseUrl;
}

function proxyRequest(req, res, options) {
  if (req.url === "/__proliferate_mux_health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  const requestPath = req.url || "/";
  const pathname = new URL(requestPath, "http://127.0.0.1").pathname;
  const targetBase = targetBaseForPath(pathname, options);
  const target = new URL(requestPath, targetBase);
  const headers = { ...req.headers, host: target.host };
  delete headers.connection;
  delete headers["proxy-connection"];

  const transport = target.protocol === "https:" ? https : http;
  const upstream = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "upstream_unavailable" }));
  });

  req.pipe(upstream);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const server = http.createServer((req, res) => proxyRequest(req, res, options));
  server.listen(options.listenPort, "127.0.0.1", () => {
    console.log(
      JSON.stringify({
        event: "dev_public_tunnel_mux_started",
        listenPort: options.listenPort,
        apiBaseUrl: options.apiBaseUrl,
        bifrostBaseUrl: options.bifrostBaseUrl,
      }),
    );
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exit(2);
}
