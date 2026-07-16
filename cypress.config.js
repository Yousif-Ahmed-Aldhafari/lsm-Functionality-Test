const { defineConfig } = require("cypress");
const fs = require("fs");
const path = require("path");
const { generateOutputs, renderCsv } = require("./cypress/utils/lsm-report-generator.cjs");

const resultsDir = path.join(__dirname, "cypress", "results");

function ensureResultsDir() {
  fs.mkdirSync(resultsDir, { recursive: true });
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "https://lsm.nexumind.com").replace(/\/+$/, "");
}

function prettifyRoute(pathname) {
  const clean = String(pathname || "")
    .replace(/^\/+/, "")
    .replace(/\/:.+$/g, "")
    .replace(/[-/]+/g, " ")
    .trim();
  if (!clean) return "Login";
  return clean.replace(/\b\w/g, (char) => char.toUpperCase());
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

async function extractLiveBundleRoutes(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const html = await fetchText(`${normalizedBaseUrl}/login`);
  const scriptNames = new Set();
  for (const match of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+\.js)"/gi)) {
    const value = match[1];
    if (!/^https?:\/\//i.test(value) || value.startsWith(normalizedBaseUrl)) {
      scriptNames.add(new URL(value, normalizedBaseUrl).href);
    }
  }

  const texts = [];
  for (const scriptUrl of scriptNames) {
    try {
      texts.push({
        scriptUrl,
        text: await fetchText(scriptUrl),
      });
    } catch (error) {
      texts.push({
        scriptUrl,
        text: "",
        error: error.message,
      });
    }
  }

  const routeMap = new Map();
  const addRoute = (rawPath, source) => {
    if (!rawPath || rawPath === "**") return;
    if (/^https?:\/\//i.test(rawPath)) return;
    const pathValue = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    if (/\/(logout|signout)(\/|$)/i.test(pathValue)) return;
    const url = new URL(pathValue, normalizedBaseUrl).href;
    const parsed = new URL(url);
    const routePattern = `${parsed.origin}${parsed.pathname
      .split("/")
      .map((segment) => {
        if (segment.startsWith(":")) return segment;
        if (/^\d+$/.test(segment)) return ":id";
        return segment;
      })
      .join("/")}`;
    const normalizedUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "") || "/"}`;
    routeMap.set(normalizedUrl, {
      url,
      normalizedUrl,
      routePattern,
      dynamicRoute: /\/:/.test(routePattern),
      source,
      module: prettifyRoute(parsed.pathname.split("/").filter(Boolean)[0] || parsed.pathname),
      submodule: prettifyRoute(parsed.pathname.split("/").filter(Boolean).slice(1).join("/")),
      pageTitle: prettifyRoute(parsed.pathname),
      visited: false,
      apiCount: 0,
    });
  };

  for (const { scriptUrl, text } of texts) {
    for (const match of text.matchAll(/path:"([^"]*)"/g)) {
      addRoute(match[1], `live bundle route map: ${path.basename(scriptUrl)}`);
    }
    for (const match of text.matchAll(/route:"([^"]+)"/g)) {
      addRoute(match[1], `live bundle menu config: ${path.basename(scriptUrl)}`);
    }
  }

  return {
    scripts: [...scriptNames],
    routes: [...routeMap.values()].sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl)),
  };
}

module.exports = defineConfig({
  e2e: {
    baseUrl: "https://lsm.nexumind.com",
    chromeWebSecurity: false,
    defaultCommandTimeout: 20000,
    pageLoadTimeout: Number(process.env.LSM_PAGE_LOAD_TIMEOUT || 180000),
    requestTimeout: 30000,
    responseTimeout: 60000,
    blockHosts: [
      "static.cloudflareinsights.com",
      "*.cloudflareinsights.com",
      "fonts.googleapis.com",
      "fonts.gstatic.com",
    ],
    retries: {
      runMode: 0,
      openMode: 0,
    },
    env: {
      LSM_LOGIN_PATH: "/login",
      LSM_USERNAME: process.env.LSM_USERNAME || "superadmin@nm-lsm.local",
      LSM_PASSWORD: process.env.LSM_PASSWORD || "Admin@NM2024!",
      LSM_PAGE_LOAD_TIMEOUT: Number(process.env.LSM_PAGE_LOAD_TIMEOUT || 180000),
      LSM_MAX_ROUTES: Number(process.env.LSM_MAX_ROUTES || 160),
      LSM_MAX_SAFE_CLICKS_PER_PAGE: Number(process.env.LSM_MAX_SAFE_CLICKS_PER_PAGE || 28),
    },
    setupNodeEvents(on, config) {
      ensureResultsDir();

      on("task", {
        writeJson({ fileName, data }) {
          ensureResultsDir();
          fs.writeFileSync(path.join(resultsDir, fileName), JSON.stringify(data, null, 2), "utf8");
          return null;
        },
        writeCsv({ fileName, rows, columns }) {
          ensureResultsDir();
          fs.writeFileSync(path.join(resultsDir, fileName), renderCsv(rows, columns), "utf8");
          return null;
        },
        generateLsmOutputs(discovery) {
          ensureResultsDir();
          return generateOutputs(discovery, { resultsDir });
        },
        extractLiveBundleRoutes({ baseUrl }) {
          return extractLiveBundleRoutes(baseUrl || config.baseUrl);
        },
        log(message) {
          console.log(message);
          return null;
        },
      });

      return config;
    },
  },
});
