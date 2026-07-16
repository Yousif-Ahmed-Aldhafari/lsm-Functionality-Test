const MAX_ROUTES = Number(Cypress.env("LSM_MAX_ROUTES") || 160);
const MAX_SAFE_CLICKS_PER_PAGE = Number(Cypress.env("LSM_MAX_SAFE_CLICKS_PER_PAGE") || 28);
const LOGIN_PATH = Cypress.env("LSM_LOGIN_PATH") || "/login";
const PAGE_LOAD_TIMEOUT = Number(Cypress.env("LSM_PAGE_LOAD_TIMEOUT") || 180000);

const unsafeTextPattern =
  /(logout|log out|sign out|delete|remove|approve|reject|deactivate|disable|submit|save|send|bulk|حذف|إزالة|ازالة|موافقة|اعتماد|رفض|تعطيل|حفظ|إرسال|ارسال|تسجيل الخروج|خروج)/i;

const safeOpenTextPattern =
  /(menu|more|filter|search|view|details|show|open|add|new|create|edit|settings|tab|قائمة|المزيد|تصفية|بحث|عرض|تفاصيل|فتح|إضافة|اضافة|جديد|تعديل|إعدادات|اعدادات)/i;

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function baseOrigin() {
  return new URL(Cypress.config("baseUrl")).origin;
}

function normalizeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl, Cypress.config("baseUrl"));
    parsed.hash = "";
    parsed.searchParams.sort();
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${pathname}${parsed.search}`;
  } catch {
    return "";
  }
}

function routePatternFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl, Cypress.config("baseUrl"));
    const segments = parsed.pathname
      .split("/")
      .map((segment) => {
        if (/^\d+$/.test(segment)) return ":id";
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ":uuid";
        if (/^[0-9a-f]{16,}$/i.test(segment)) return ":hash";
        return segment;
      });
    return `${parsed.origin}${segments.join("/")}`;
  } catch {
    return rawUrl;
  }
}

function isDynamicRoute(rawUrl) {
  return /\/(:id|:uuid|:hash|\d{2,}|[0-9a-f]{8,})(?=\/|$)/i.test(routePatternFromUrl(rawUrl));
}

function hasDynamicPlaceholder(rawUrl) {
  try {
    const parsed = new URL(rawUrl, Cypress.config("baseUrl"));
    return parsed.pathname.split("/").some((segment) => segment.startsWith(":"));
  } catch {
    return /\/:[^/]+/.test(String(rawUrl || ""));
  }
}

function isInternalRoute(rawUrl) {
  try {
    const parsed = new URL(rawUrl, Cypress.config("baseUrl"));
    if (parsed.origin !== baseOrigin()) return false;
    if (/\/(login|logout|signout)(\/|$)/i.test(parsed.pathname)) return false;
    if (/\.(js|css|png|jpg|jpeg|svg|gif|ico|woff2?|ttf|map|pdf|xlsx?|docx?)(\?|$)/i.test(parsed.pathname)) return false;
    if (/logout|signout|تسجيل-الخروج|خروج/i.test(rawUrl)) return false;
    return true;
  } catch {
    return false;
  }
}

function displayUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl, Cypress.config("baseUrl"));
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return rawUrl;
  }
}

function waitForDocumentReady() {
  cy.document({ timeout: 90000 }).should((doc) => {
    expect(["interactive", "complete"]).to.include(doc.readyState);
  });
  cy.get("body", { timeout: 90000 }).should("be.visible");
  cy.get("body", { timeout: 90000 }).should(($body) => {
    expect(normalizeText($body.text()).length, "page has visible text").to.be.greaterThan(5);
  });
}

function visitLsm(pathOrUrl, options = {}) {
  return cy.visit(pathOrUrl, {
    failOnStatusCode: false,
    timeout: PAGE_LOAD_TIMEOUT,
    ...options,
  });
}

function settleBrowserFrames() {
  cy.window({ log: false }).then(
    (win) =>
      new Cypress.Promise((resolve) => {
        win.requestAnimationFrame(() => win.requestAnimationFrame(resolve));
      }),
  );
}

function isUsefulApiRequest(url) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== baseOrigin()) return false;
    if (/\.(js|css|png|jpg|jpeg|svg|gif|ico|woff2?|ttf|map)(\?|$)/i.test(parsed.pathname)) return false;
    if (/cloudflare|beacon|sockjs|hot-update/i.test(url)) return false;
    return /api|auth|login|account|admin|user|role|dashboard|report|lookup|setting|workflow|request|employee|succession|lsm/i.test(url);
  } catch {
    return false;
  }
}

function pageModule(page) {
  return normalizeText(page.module || page.headings?.[0]?.text || displayUrl(page.url).split("/").filter(Boolean)[0] || "Application");
}

function pageTitle(page) {
  return normalizeText(page.pageTitle || page.title || page.headings?.[0]?.text || pageModule(page));
}

describe("LSM application discovery", () => {
  it("discovers authenticated LSM functionality and generates CSV test cases", () => {
    const routeQueue = [];
    const queued = new Set();
    const visited = new Set();
    const routeMap = new Map();
    const apiRequests = [];
    const apiSeen = new Set();

    const discovery = {
      startedAt: new Date().toISOString(),
      targetUrl: `${Cypress.config("baseUrl")}${LOGIN_PATH}`,
      baseUrl: Cypress.config("baseUrl"),
      authenticatedLandingUrl: "",
      pages: [],
      routes: [],
      apiRequests,
      skippedActions: [],
      pagesNotSafelyExplored: [],
      safeExplorationRules: {
        maxRoutes: MAX_ROUTES,
        maxSafeClicksPerPage: MAX_SAFE_CLICKS_PER_PAGE,
        destructiveActionsSkipped: true,
        permanentDataChangesAllowed: false,
      },
    };

    function upsertRoute(rawUrl, source = "discovered", context = {}) {
      if (!rawUrl || !isInternalRoute(rawUrl)) return false;
      const normalizedUrl = normalizeUrl(rawUrl);
      if (!normalizedUrl) return false;
      const routePattern = context.routePattern || routePatternFromUrl(rawUrl);
      const dynamicRoute = Boolean(context.dynamicRoute || isDynamicRoute(rawUrl) || /\/:[^/]+/.test(routePattern));
      const dynamicPlaceholder = Boolean(context.dynamicPlaceholder || hasDynamicPlaceholder(rawUrl) || /\/:[^/]+/.test(routePattern));

      const existing = routeMap.get(normalizedUrl) || {};
      routeMap.set(normalizedUrl, {
        ...existing,
        url: rawUrl,
        normalizedUrl,
        routePattern,
        dynamicRoute,
        dynamicPlaceholder,
        source: existing.source || source,
        module: existing.module || context.module || "",
        submodule: existing.submodule || context.submodule || "",
        pageTitle: existing.pageTitle || context.pageTitle || "",
        visited: existing.visited || false,
        apiCount: existing.apiCount || 0,
        discoveryLimitation: existing.discoveryLimitation || context.discoveryLimitation || "",
      });

      const shouldQueue = context.queue !== false && !dynamicPlaceholder;
      if (shouldQueue && !queued.has(normalizedUrl) && !visited.has(normalizedUrl) && routeQueue.length + visited.size < MAX_ROUTES) {
        queued.add(normalizedUrl);
        routeQueue.push({ url: rawUrl, normalizedUrl, source, context });
      }
      return true;
    }

    function markVisited(page, apiCount) {
      const normalizedUrl = normalizeUrl(page.url);
      const existing = routeMap.get(normalizedUrl) || {};
      routeMap.set(normalizedUrl, {
        ...existing,
        url: page.url,
        normalizedUrl,
        routePattern: page.routePattern || routePatternFromUrl(page.url),
        dynamicRoute: isDynamicRoute(page.url),
        source: existing.source || page.source || "visited",
        module: page.module || existing.module || "",
        submodule: page.submodule || existing.submodule || "",
        pageTitle: pageTitle(page),
        visited: true,
        apiCount,
      });
    }

    function recordSkippedAction(action, reason, page) {
      discovery.skippedActions.push({
        reason,
        text: action.text || action.ariaLabel || action.title || "",
        selector: action.selector || "",
        url: page?.url || "",
        module: page ? pageModule(page) : "",
      });
    }

    function collectAndQueueCurrentPage(source, apiStartIndex = 0) {
      waitForDocumentReady();
      cy.expandVisibleNavigation();
      settleBrowserFrames();

      return cy.collectPageStructure().then((page) => {
        page.source = source;
        page.apiRequests = apiRequests.slice(apiStartIndex);
        page.dynamicRoute = isDynamicRoute(page.url);
        page.discoveredRouteCount = page.routes.length;
        page.discoverySummary = {
          forms: page.forms.length,
          fields:
            page.inputFields.length +
            page.textAreas.length +
            page.selectLists.length +
            page.checkboxes.length +
            page.radioButtons.length +
            page.fileUploadFields.length,
          tables: page.tables.length,
          actions: page.availableActions.length,
          modals: page.modals.length,
        };

        const normalizedUrl = normalizeUrl(page.url);
        const pageAlreadyCaptured = discovery.pages.some((existing) => normalizeUrl(existing.url) === normalizedUrl);
        if (!pageAlreadyCaptured) {
          discovery.pages.push(page);
        }
        markVisited(page, page.apiRequests.length);

        for (const route of page.routes) {
          upsertRoute(route.url, route.source || "page route", {
            module: page.module,
            submodule: page.submodule,
            pageTitle: pageTitle(page),
          });
        }

        for (const card of page.cards || []) {
          for (const cardLink of card.links || []) {
            upsertRoute(cardLink, "card link", {
              module: page.module,
              submodule: page.submodule,
              pageTitle: pageTitle(page),
            });
          }
        }

        for (const action of page.availableActions || []) {
          if (action.unsafe || unsafeTextPattern.test(`${action.text || ""} ${action.ariaLabel || ""} ${action.title || ""}`)) {
            recordSkippedAction(action, "Unsafe action skipped during discovery", page);
          }
        }

        return page;
      });
    }

    function closeAnyOpenDialogs() {
      cy.window({ log: false }).then((win) => {
        const escapeEvent = new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true,
        });
        win.document.dispatchEvent(escapeEvent);

        const closeCandidates = [
          ...win.document.querySelectorAll("button,[role='button'],.btn-close,.close,[aria-label*='close' i],[aria-label*='إغلاق' i]"),
        ]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = win.getComputedStyle(element);
            const text = normalizeText(element.innerText || element.getAttribute("aria-label") || element.getAttribute("title"));
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              /close|cancel|إغلاق|اغلاق|إلغاء|الغاء|×|x/i.test(text)
            );
          })
          .slice(0, 5);

        for (const element of closeCandidates) {
          try {
            element.click();
          } catch {
            // Best-effort close.
          }
        }
      });
      settleBrowserFrames();
    }

    function clickSafeControlsOnPage(page) {
      const candidates = (page.availableActions || [])
        .filter((action) => {
          const text = normalizeText(`${action.text || ""} ${action.ariaLabel || ""} ${action.title || ""}`);
          if (!text && !action.hasPopup) return false;
          if (action.disabled) return false;
          if (action.unsafe || unsafeTextPattern.test(text)) return false;
          return Boolean(action.hasPopup || action.safeToOpen || safeOpenTextPattern.test(text));
        })
        .slice(0, MAX_SAFE_CLICKS_PER_PAGE);

      const clickNext = (index) => {
        if (index >= candidates.length) return cy.wrap(null, { log: false });
        const candidate = candidates[index];
        const text = normalizeText(`${candidate.text || ""} ${candidate.ariaLabel || ""} ${candidate.title || ""}`) || candidate.selector;
        const beforeUrl = normalizeUrl(page.url);

        return cy.document({ log: false })
          .then((doc) => {
            const element = candidate.selector ? doc.querySelector(candidate.selector) : null;
            if (!element) {
              discovery.skippedActions.push({
                reason: "Safe candidate no longer existed when clicked",
                text,
                selector: candidate.selector || "",
                url: page.url,
                module: pageModule(page),
              });
              return false;
            }
            const rect = element.getBoundingClientRect();
            const style = doc.defaultView.getComputedStyle(element);
            if (rect.width === 0 || rect.height === 0 || style.display === "none" || style.visibility === "hidden") {
              return false;
            }
            try {
              element.click();
              return true;
            } catch (error) {
              discovery.skippedActions.push({
                reason: `Safe candidate click failed: ${error.message}`,
                text,
                selector: candidate.selector || "",
                url: page.url,
                module: pageModule(page),
              });
              return false;
            }
          })
          .then((clicked) => {
            if (!clicked) return null;
            settleBrowserFrames();
            return cy.location("href", { timeout: 15000 }).then((afterHref) => {
              const afterUrl = normalizeUrl(afterHref);
              if (afterUrl && afterUrl !== beforeUrl) {
                upsertRoute(afterHref, `safe action: ${text}`, {
                  module: page.module,
                  submodule: page.submodule,
                  pageTitle: pageTitle(page),
                });
                if (isInternalRoute(afterHref)) {
                  cy.go("back");
                  waitForDocumentReady();
                  cy.expandVisibleNavigation();
                  settleBrowserFrames();
                }
                return null;
              }

              return cy.collectPageStructure().then((updatedPage) => {
                updatedPage.source = `safe action overlay: ${text}`;
                updatedPage.apiRequests = [];
                updatedPage.parentUrl = page.url;
                updatedPage.dynamicRoute = isDynamicRoute(updatedPage.url);

                for (const route of updatedPage.routes || []) {
                  upsertRoute(route.url, `safe action overlay: ${text}`, {
                    module: page.module,
                    submodule: page.submodule,
                    pageTitle: pageTitle(page),
                  });
                }

                if ((updatedPage.modals || []).length > 0) {
                  const modalKey = `${normalizeUrl(page.url)}::modal::${text}`;
                  if (!discovery.pages.some((existing) => existing.modalKey === modalKey)) {
                    updatedPage.modalKey = modalKey;
                    discovery.pages.push(updatedPage);
                  }
                }

                closeAnyOpenDialogs();
                return null;
              });
            });
          })
          .then(() => clickNext(index + 1));
      };

      return clickNext(0);
    }

    function visitNextRoute() {
      if (routeQueue.length === 0 || visited.size >= MAX_ROUTES) {
        return cy.wrap(null, { log: false });
      }

      const route = routeQueue.shift();
      queued.delete(route.normalizedUrl);
      if (visited.has(route.normalizedUrl)) {
        return visitNextRoute();
      }
      visited.add(route.normalizedUrl);

      const apiStartIndex = apiRequests.length;
      cy.task("log", `Discovering ${visited.size}/${MAX_ROUTES}: ${displayUrl(route.url)} (${route.source})`);

      return cy
        .then(() => visitLsm(route.url))
        .then(() => collectAndQueueCurrentPage(route.source, apiStartIndex))
        .then((page) => clickSafeControlsOnPage(page))
        .then(() => visitNextRoute());
    }

    function syntheticPageFromRoute(route, reason) {
      return {
        capturedAt: new Date().toISOString(),
        title: route.pageTitle || route.module || displayUrl(route.url),
        pageTitle: route.pageTitle || route.module || displayUrl(route.url),
        url: route.url,
        normalizedUrl: route.normalizedUrl,
        routePattern: route.routePattern,
        dynamicRoute: route.dynamicRoute,
        module: route.module || "Application",
        submodule: route.submodule || "",
        language: "ar",
        direction: "rtl",
        source: route.source,
        discoveryLimitation: reason,
        staticRouteOnly: true,
        headings: [{ level: 1, text: route.pageTitle || route.module || displayUrl(route.url), selector: "live-bundle-route" }],
        breadcrumbs: [],
        navItems: [],
        sidebarItems: [],
        topNavigationItems: [],
        buttons: [],
        links: [],
        routes: [],
        forms: [],
        inputFields: [],
        textAreas: [],
        selectLists: [],
        checkboxes: [],
        radioButtons: [],
        dateFields: [],
        fileUploadFields: [],
        tables: [],
        tableColumns: [],
        searchFields: [],
        filters: [],
        sortingControls: [],
        pagination: [],
        tabs: [],
        cards: [],
        charts: [],
        modals: [],
        confirmationDialogs: [],
        statusValues: [],
        availableActions: [],
        dropdowns: [],
        apiRequests: [],
      };
    }

    function seedRoutesFromLiveBundle({ queueStaticRoutes, discoveryLimitation = "" }) {
      return cy.task("extractLiveBundleRoutes", { baseUrl: Cypress.config("baseUrl") }, { timeout: 180000 }).then((bundle) => {
        discovery.liveBundleScripts = bundle.scripts || [];
        discovery.routeDiscoverySources = [
          ...(discovery.routeDiscoverySources || []),
          {
            source: "live Angular bundle route map",
            scriptCount: discovery.liveBundleScripts.length,
            routeCount: (bundle.routes || []).length,
            queueStaticRoutes,
            discoveryLimitation,
          },
        ];

        for (const route of bundle.routes || []) {
          const dynamicPlaceholder = Boolean(route.dynamicRoute || hasDynamicPlaceholder(route.url) || /\/:[^/]+/.test(route.routePattern || ""));
          const limitation = [
            discoveryLimitation,
            dynamicPlaceholder
              ? "Dynamic route pattern requires a real record identifier and is recorded but not visited unless a concrete UI link is discovered."
              : "",
          ]
            .filter(Boolean)
            .join(" ");

          upsertRoute(route.url, route.source || "live bundle route map", {
            ...route,
            queue: queueStaticRoutes && !dynamicPlaceholder,
            dynamicPlaceholder,
            discoveryLimitation: limitation,
          });
        }
      });
    }

    function markUnvisitedRoutesLimited(reason) {
      for (const [normalizedUrl, route] of routeMap.entries()) {
        if (!route.visited) {
          routeMap.set(normalizedUrl, {
            ...route,
            discoveryLimitation: [reason, route.discoveryLimitation].filter(Boolean).join(" "),
          });
        }
      }
    }

    function finalizeDiscovery(authenticated) {
      return cy.then(() => {
        for (const route of routeMap.values()) {
          const alreadyCaptured = discovery.pages.some((page) => normalizeUrl(page.url) === route.normalizedUrl);
          if (!route.visited && !alreadyCaptured) {
            const reason =
              route.discoveryLimitation ||
              (route.dynamicPlaceholder
                ? "Dynamic route pattern requires a concrete record identifier; no safe record link was discovered during exploration."
                : "Route was discovered but not visited before the configured route limit or access restriction stopped exploration.");
            discovery.pages.push(syntheticPageFromRoute(route, reason));
            discovery.pagesNotSafelyExplored.push({
              url: route.url,
              module: route.module || "Application",
              reason,
              action: "Route navigation",
            });
          }
        }

        discovery.finishedAt = new Date().toISOString();
        discovery.routes = [...routeMap.values()].sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl));
        discovery.apiRequests = apiRequests;
        discovery.pagesNotSafelyExplored = [
          ...discovery.pagesNotSafelyExplored,
          ...discovery.skippedActions
            .filter((item) => /unsafe/i.test(item.reason || ""))
            .map((item) => ({
              url: item.url,
              module: item.module,
              reason: item.reason,
              action: item.text,
            })),
        ];

        if (authenticated) {
          expect(discovery.authenticatedLandingUrl, "authenticated landing URL").to.not.include(LOGIN_PATH);
        } else {
          expect(discovery.authenticationStatus?.success, "authentication failed and was documented").to.eq(false);
        }
        expect(discovery.pages.length, "pages or route-map pages discovered").to.be.greaterThan(0);
        const uniqueRoutes = new Set(discovery.routes.map((route) => route.normalizedUrl));
        expect(uniqueRoutes.size, "routes are unique").to.eq(discovery.routes.length);

        return cy.saveDiscoveryResult(discovery).then((summary) => {
          cy.task(
            "log",
            `LSM discovery complete: routes=${summary.routeCount}, modules=${summary.moduleCount}, forms=${summary.formCount}, tables=${summary.tableCount}, totalCases=${summary.totalTestCases}, automated=${summary.automatedTestCases}, manual=${summary.manualTestCases}, partial=${summary.partialAutomationTestCases}`,
          );
          for (const validation of summary.validations) {
            expect(validation.ok, `${validation.filePath} CSV validation`).to.eq(true);
            expect(validation.hasMultilineSteps, `${validation.filePath} has multiline steps`).to.eq(true);
            expect(validation.hasArabic, `${validation.filePath} preserves Arabic`).to.eq(true);
          }
        });
      });
    }

    function runAuthenticatedDiscovery(loginProbe) {
      const token = loginProbe.body.data;
      seedRoutesFromLiveBundle({ queueStaticRoutes: true });

      visitLsm("/dashboard", {
        onBeforeLoad(win) {
          win.localStorage.setItem("auth_token", token);
        },
      });
      waitForDocumentReady();
      return cy.location("href").then((landingUrl) => {
        const landingPath = new URL(landingUrl).pathname.toLowerCase();
        if (landingPath === LOGIN_PATH.toLowerCase()) {
          const reason =
            "The authentication API returned a token, but the live frontend route guard redirected back to /login; protected UI routes were not visited.";
          discovery.authenticatedLandingUrl = landingUrl;
          discovery.authenticationStatus = {
            success: false,
            method: "POST /api/v1/Auth/login token seeded into localStorage",
            statusCode: loginProbe.status,
            responseCode: loginProbe.body?.code ?? "",
            message: reason,
          };
          discovery.pagesNotSafelyExplored.push({
            url: Cypress.config("baseUrl"),
            module: "Authenticated application",
            reason,
            action: "Frontend route guard",
          });
          markUnvisitedRoutesLimited(reason);
          return collectAndQueueCurrentPage("login page after frontend rejected API token", 0).then(() => finalizeDiscovery(false));
        }

        discovery.authenticatedLandingUrl = landingUrl;
        discovery.authenticationStatus = {
          success: true,
          method: "POST /api/v1/Auth/login token seeded into localStorage",
        };
        upsertRoute(landingUrl, "authenticated landing page", {
          module: "Landing",
          pageTitle: "Authenticated landing page",
        });
        return visitNextRoute().then(() => finalizeDiscovery(true));
      });
    }

    function runUnauthenticatedFallback(loginProbe) {
      const loginApiUrl = new URL("/api/v1/Auth/login", Cypress.config("baseUrl")).href;
      const apiKey = `POST|${loginApiUrl}|${loginProbe.status}`;
      if (!apiSeen.has(apiKey)) {
        apiSeen.add(apiKey);
        apiRequests.push({
          capturedAt: new Date().toISOString(),
          method: "POST",
          url: loginApiUrl,
          statusCode: loginProbe.status,
          requestBodyType: "object",
          responseContentType: "application/json",
          resourceType: "auth preflight",
        });
      }

      discovery.authenticationStatus = {
        success: false,
        method: "POST /api/v1/Auth/login",
        statusCode: loginProbe.status,
        responseCode: loginProbe.body?.code ?? "",
        responseBody: loginProbe.body || null,
        message:
          "The provided Super Admin credentials were rejected by the live authentication API, so authenticated UI exploration could not be completed.",
      };

      discovery.pagesNotSafelyExplored.push({
        url: Cypress.config("baseUrl"),
        module: "Authenticated application",
        reason: "Authentication failed with the supplied credentials; protected routes were extracted from the live bundle but not visited.",
        action: "Login",
      });

      cy.task(
        "log",
        `Authentication preflight failed: status=${loginProbe.status}, body=${JSON.stringify(loginProbe.body)}`,
      );

      visitLsm(LOGIN_PATH);
      collectAndQueueCurrentPage("public login page - authentication failed", 0);

      seedRoutesFromLiveBundle({
        queueStaticRoutes: false,
        discoveryLimitation:
          "Route was discovered from the live Angular bundle because authentication failed; UI elements behind the route were not visited.",
      });

      return finalizeDiscovery(false);
    }

    cy.intercept("**", (req) => {
      req.on("response", (res) => {
        if (!isUsefulApiRequest(req.url)) return;
        const key = `${req.method}|${req.url}|${res.statusCode}`;
        if (apiSeen.has(key)) return;
        apiSeen.add(key);
        apiRequests.push({
          capturedAt: new Date().toISOString(),
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          requestBodyType: req.body ? typeof req.body : "",
          responseContentType: res.headers?.["content-type"] || res.headers?.["Content-Type"] || "",
          resourceType: req.resourceType || "",
        });
      });
    });

    cy.fixture("lsm-test-data").then((testData) => {
      const credentials = {
        username: Cypress.env("LSM_USERNAME") || testData.credentials.superAdmin.username,
        password: Cypress.env("LSM_PASSWORD") || testData.credentials.superAdmin.password,
      };

      cy.request({
        method: "POST",
        url: "/api/v1/Auth/login",
        failOnStatusCode: false,
        body: {
          email: credentials.username,
          password: credentials.password,
        },
      }).then((loginProbe) => {
        if (loginProbe.status >= 200 && loginProbe.status < 300 && loginProbe.body?.isSuccess && loginProbe.body?.data) {
          return runAuthenticatedDiscovery(loginProbe);
        } else {
          return runUnauthenticatedFallback(loginProbe);
        }
      });
    });
  });
});
