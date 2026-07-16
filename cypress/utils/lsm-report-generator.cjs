const fs = require("fs");
const path = require("path");

const CSV_COLUMNS = [
  "Project",
  "Tracker",
  "TC-ID",
  "Subject",
  "Description",
  "Status",
  "Priority",
  "Category",
  "Operating System",
  "Test Platform",
  "Test Type",
  "Language",
  "Test Steps",
  "Expected Result",
  "Actual Result",
  "Assignee",
  "% Done",
  "Target version",
  "Browser",
  "Automation/Manual",
  "Start date",
  "Note",
  "Bug ID",
];

const ROUTE_COLUMNS = [
  "Route ID",
  "URL",
  "Normalized URL",
  "Route Pattern",
  "Module",
  "Submodule",
  "Page Title",
  "Source",
  "Dynamic Route",
  "Visited",
  "API Count",
];

const DEFAULTS = {
  Project: "LSM",
  Tracker: "Test Case",
  Status: "Not Run",
  "Operating System": "Windows",
  "Test Platform": "Web",
  Language: "Both",
  "Actual Result": "",
  Assignee: "",
  "% Done": "0",
  "Target version": "LSM Web",
  Browser: "Chrome",
  "Automation/Manual": "Automation",
  "Start date": "",
  "Bug ID": "",
};

const ROLE_NAMES = [
  "Super Admin",
  "Admin",
  "Manager",
  "Reviewer",
  "Employee",
  "Read-only user",
];

const VIEWPORTS = [
  "1920x1080 desktop",
  "1440x900 desktop",
  "1366x768 laptop",
  "tablet portrait and landscape",
  "mobile portrait and landscape",
];

const ARABIC_SAMPLE = "اختبار سايبريس";
const ENGLISH_SAMPLE = "Cypress test data";
const MIXED_SAMPLE = "Cypress اختبار 2026";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeLineBreaks(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function csvEscape(value) {
  const text = normalizeLineBreaks(value);
  let needsQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' || char === "," || char === "\n") {
      needsQuotes = true;
      break;
    }
  }

  if (!needsQuotes) {
    return text;
  }

  let escaped = '"';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    escaped += char === '"' ? '""' : char;
  }
  escaped += '"';
  return escaped;
}

function renderCsv(rows, columns) {
  let output = "\ufeff";

  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    if (columnIndex > 0) {
      output += ",";
    }
    output += csvEscape(columns[columnIndex]);
  }
  output += "\n";

  for (const row of rows) {
    let line = "";
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      if (columnIndex > 0) {
        line += ",";
      }
      const column = columns[columnIndex];
      line += csvEscape(row[column]);
    }
    output += line;
    output += "\n";
  }

  return output;
}

function writeCsv(filePath, rows, columns = CSV_COLUMNS) {
  fs.writeFileSync(filePath, renderCsv(rows, columns), "utf8");
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactText(value, fallback = "") {
  const text = normalizeLineBreaks(value)
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of safeArray(items)) {
    const key = keyFn(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function textMatches(value, patterns) {
  const text = compactText(value).toLowerCase();
  return patterns.some((pattern) =>
    typeof pattern === "string" ? text.includes(pattern.toLowerCase()) : pattern.test(text),
  );
}

function isDynamicRoute(urlOrPattern) {
  return /\/(:id|\d{2,}|[0-9a-f]{8,}|\{id\})/i.test(urlOrPattern || "");
}

function routePatternFromUrl(url) {
  try {
    const parsed = new URL(url);
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
    return url || "";
  }
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.searchParams.sort();
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${pathname}${parsed.search}`;
  } catch {
    return compactText(url);
  }
}

function displayUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url || "/";
  }
}

function pageModule(page) {
  return compactText(
    page.module ||
      safeArray(page.breadcrumbs)[0]?.text ||
      safeArray(page.headings)[0]?.text ||
      displayUrl(page.url).split("/").filter(Boolean)[0],
    "Application",
  );
}

function pageSubmodule(page) {
  return compactText(
    page.submodule ||
      safeArray(page.breadcrumbs)[1]?.text ||
      safeArray(page.headings)[1]?.text ||
      displayUrl(page.url).split("/").filter(Boolean)[1],
    "",
  );
}

function pageTitle(page) {
  return compactText(
    page.pageTitle ||
      page.title ||
      safeArray(page.headings)[0]?.text ||
      pageModule(page),
    "LSM page",
  );
}

function pageNote(page, extra = "") {
  const parts = [
    `URL: ${page.url || ""}`,
    `Module: ${pageModule(page)}`,
  ];
  const submodule = pageSubmodule(page);
  if (submodule) {
    parts.push(`Submodule: ${submodule}`);
  }
  if (extra) {
    parts.push(extra);
  }
  if (page.source) {
    parts.push(`Discovery source: ${page.source}`);
  }
  if (page.discoveryLimitation) {
    parts.push(`Automation limitation: ${page.discoveryLimitation}`);
  }
  return parts.join("; ");
}

function steps(...items) {
  return items
    .filter(Boolean)
    .map((item, index) => `${index + 1}. ${item}`)
    .reduce((output, line, index) => (index === 0 ? line : `${output}\n${line}`), "");
}

function describeField(field, index = 0) {
  const label = compactText(
    field.label ||
      field.placeholder ||
      field.name ||
      field.id ||
      field.ariaLabel ||
      field.selector,
  );
  if (label) {
    return label;
  }
  return `${field.type || "field"} ${index + 1}`;
}

function describeTable(table, index = 0) {
  return compactText(table.caption || table.label || table.selector, `table ${index + 1}`);
}

function describeAction(action, index = 0) {
  return compactText(action.text || action.ariaLabel || action.title || action.selector, `action ${index + 1}`);
}

function fieldType(field) {
  return compactText(field.type || field.inputType || field.tagName, "text").toLowerCase();
}

function fieldIsNumeric(field) {
  const type = fieldType(field);
  return type === "number" || /amount|count|number|qty|quantity|percentage|rate|score|order|رقم|عدد|نسبة/i.test(describeField(field));
}

function fieldIsDate(field) {
  const type = fieldType(field);
  return type.includes("date") || /date|time|calendar|تاريخ|وقت/i.test(describeField(field));
}

function fieldIsEmail(field) {
  const type = fieldType(field);
  return type === "email" || /email|mail|بريد/i.test(describeField(field));
}

function fieldIsFile(field) {
  return fieldType(field) === "file";
}

function actionKind(action) {
  const text = describeAction(action);
  const map = [
    ["create", [/create/i, /add/i, /new/i, /إضافة/i, /اضافة/i, /جديد/i]],
    ["view", [/view/i, /details/i, /show/i, /عرض/i, /تفاصيل/i]],
    ["edit", [/edit/i, /update/i, /modify/i, /تعديل/i, /تحديث/i]],
    ["delete", [/delete/i, /remove/i, /حذف/i, /إزالة/i]],
    ["archive", [/archive/i, /أرشفة/i, /ارشفة/i]],
    ["restore", [/restore/i, /استعادة/i]],
    ["activate", [/activate/i, /enable/i, /تفعيل/i]],
    ["deactivate", [/deactivate/i, /disable/i, /تعطيل/i, /إلغاء التفعيل/i]],
    ["approve", [/approve/i, /accept/i, /موافقة/i, /اعتماد/i, /قبول/i]],
    ["reject", [/reject/i, /رفض/i]],
    ["export", [/export/i, /download/i, /تصدير/i, /تحميل/i]],
    ["filter", [/filter/i, /تصفية/i]],
    ["search", [/search/i, /بحث/i]],
    ["cancel", [/cancel/i, /إلغاء/i, /الغاء/i]],
    ["reset", [/reset/i, /clear/i, /مسح/i, /إعادة/i]],
    ["submit", [/save/i, /submit/i, /حفظ/i, /إرسال/i, /ارسال/i]],
  ];
  for (const [kind, patterns] of map) {
    if (textMatches(text, patterns)) {
      return kind;
    }
  }
  return "action";
}

function collectFields(page) {
  const fields = [
    ...safeArray(page.inputFields),
    ...safeArray(page.textAreas),
    ...safeArray(page.selectLists),
    ...safeArray(page.checkboxes),
    ...safeArray(page.radioButtons),
    ...safeArray(page.dateFields),
    ...safeArray(page.fileUploadFields),
  ];
  return uniqueBy(fields, (field, index) =>
    compactText(`${field.selector || ""}|${field.name || ""}|${field.id || ""}|${describeField(field, index)}|${field.type || ""}`),
  );
}

function collectActions(page) {
  return uniqueBy(
    [
      ...safeArray(page.buttons),
      ...safeArray(page.availableActions),
      ...safeArray(page.links).filter((link) => link.isActionLike),
    ],
    (action, index) => compactText(`${action.selector || ""}|${action.href || ""}|${describeAction(action, index)}`),
  );
}

function collectTables(page) {
  return uniqueBy(safeArray(page.tables), (table, index) =>
    compactText(`${table.selector || ""}|${describeTable(table, index)}|${safeArray(table.columns).join("|")}`),
  );
}

function collectForms(page) {
  const forms = safeArray(page.forms);
  if (forms.length > 0) {
    return uniqueBy(forms, (form, index) => compactText(`${form.selector || ""}|${form.name || ""}|${form.title || ""}|${index}`));
  }
  const fields = collectFields(page);
  return fields.length > 0
    ? [
        {
          selector: "document-field-group",
          title: `${pageTitle(page)} field group`,
          fields,
        },
      ]
    : [];
}

function normalizeDiscovery(discovery) {
  const pages = uniqueBy(safeArray(discovery.pages), (page) => normalizeUrl(page.url || page.normalizedUrl));
  for (const page of pages) {
    page.normalizedUrl = normalizeUrl(page.normalizedUrl || page.url);
    page.routePattern = page.routePattern || routePatternFromUrl(page.url || page.normalizedUrl);
    page.module = pageModule(page);
    page.submodule = pageSubmodule(page);
  }

  const routeRows = [
    ...safeArray(discovery.routes),
    ...pages.map((page) => ({
      url: page.url,
      normalizedUrl: page.normalizedUrl,
      routePattern: page.routePattern,
      module: page.module,
      submodule: page.submodule,
      pageTitle: pageTitle(page),
      source: page.source || "visited page",
      visited: true,
      apiCount: safeArray(page.apiRequests).length,
    })),
  ];

  const routes = uniqueBy(routeRows, (route) => normalizeUrl(route.normalizedUrl || route.url)).map((route) => {
    const normalized = normalizeUrl(route.normalizedUrl || route.url);
    return {
      ...route,
      normalizedUrl: normalized,
      routePattern: route.routePattern || routePatternFromUrl(normalized),
      dynamicRoute: Boolean(route.dynamicRoute || isDynamicRoute(route.routePattern || normalized)),
    };
  });

  const apiRequests = uniqueBy(
    [
      ...safeArray(discovery.apiRequests),
      ...pages.flatMap((page) => safeArray(page.apiRequests)),
    ],
    (request) => compactText(`${request.method}|${request.url}|${request.statusCode}|${request.resourceType || ""}`),
  );

  const modules = uniqueBy(
    pages.map((page) => ({
      module: pageModule(page),
      submodule: pageSubmodule(page),
    })),
    (item) => `${item.module}|${item.submodule}`,
  );

  return {
    ...discovery,
    pages,
    routes,
    apiRequests,
    modules,
  };
}

function addCase(state, input) {
  const id = `LSM-TC-${String(state.nextId).padStart(3, "0")}`;
  state.nextId += 1;

  const row = {
    ...DEFAULTS,
    "TC-ID": id,
    Subject: compactText(input.subject, `Verify ${input.category || "LSM"} behavior`),
    Description: compactText(input.description, ""),
    Priority: input.priority || "Medium",
    Category: input.category || "Functional",
    "Test Type": input.testType || "Functional",
    Language: input.language || DEFAULTS.Language,
    "Test Steps": normalizeLineBreaks(input.testSteps || ""),
    "Expected Result": compactText(input.expectedResult, ""),
    "Automation/Manual": input.automation || DEFAULTS["Automation/Manual"],
    Note: compactText(input.note, ""),
  };

  for (const column of CSV_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(row, column)) {
      row[column] = "";
    }
  }

  const finalRow = {};
  for (const column of CSV_COLUMNS) {
    finalRow[column] = row[column];
  }
  state.cases.push(finalRow);
}

function addAuthenticationCases(state, loginUrl) {
  const authCases = [
    ["Verify successful login using valid Super Admin credentials", "Positive", "Critical", "Automation", "Enter the valid Super Admin username and password.", "Login succeeds and the authenticated landing page is displayed."],
    ["Verify login validation for an invalid username", "Negative", "Critical", "Automation", "Enter an unknown username with the valid password.", "Login is rejected and a clear validation or authentication error is shown."],
    ["Verify login validation for an invalid password", "Negative", "Critical", "Automation", "Enter the valid username with an invalid password.", "Login is rejected and no authenticated session is created."],
    ["Verify login validation when username is empty", "Validation", "Critical", "Automation", "Leave the username field empty and enter the password.", "The username required validation is shown and the login request is not submitted."],
    ["Verify login validation when password is empty", "Validation", "Critical", "Automation", "Enter the username and leave the password field empty.", "The password required validation is shown and the login request is not submitted."],
    ["Verify login validation when both fields are empty", "Validation", "Critical", "Automation", "Leave both username and password empty.", "Required validation is shown for both fields and login is blocked."],
    ["Verify login validation for invalid email format", "Validation", "High", "Automation", "Enter an invalid email format in the username field.", "The email format validation is displayed before or during submission."],
    ["Verify login handling of leading spaces in username", "Negative", "High", "Automation", "Prefix the valid username with spaces and submit.", "The app either trims safely or rejects the value without creating an unintended session."],
    ["Verify login handling of trailing spaces in username", "Negative", "High", "Automation", "Suffix the valid username with spaces and submit.", "The app either trims safely or rejects the value with a clear message."],
    ["Verify login username case sensitivity handling", "Negative", "High", "Automation", "Change the case of the valid username and submit.", "Authentication behavior is consistent with the configured identity rules and no duplicate user identity is created."],
    ["Verify password masking on the login form", "Security", "Critical", "Automation", "Type the password into the password field.", "The password characters are masked by default."],
    ["Verify password visibility toggle on the login form", "Functional", "Medium", "Automation", "Use the password visibility control when available.", "The password visibility changes only while requested and the field value is preserved."],
    ["Verify Enter-key submission on the login form", "Functional", "High", "Automation", "Enter valid credentials and press Enter.", "The login form submits and redirects to the authenticated landing page."],
    ["Verify multiple failed login attempts are handled safely", "Security", "Critical", "Partial Automation", "Submit several invalid login attempts below any lockout threshold.", "The app shows safe errors, prevents account enumeration, and applies rate-limit or lockout behavior if configured."],
    ["Verify login loading state during authentication", "Functional", "High", "Automation", "Submit valid credentials and observe the login button and loading indicator.", "A loading state is shown and duplicate submissions are prevented."],
    ["Verify login API failure handling", "API", "Critical", "Automation", "Intercept the login API and return an error response.", "The login page remains visible and displays a user-safe error message."],
    ["Verify login timeout handling", "Performance", "High", "Automation", "Delay the login API response beyond the configured timeout.", "The app shows timeout or retry feedback and does not create a partial session."],
    ["Verify authenticated session creation after login", "Security", "Critical", "Automation", "Log in successfully and inspect protected navigation and browser storage.", "Session cookies or tokens are created according to the app security model and protected navigation is visible."],
    ["Verify session persistence after authenticated refresh", "Regression", "High", "Automation", "Log in and refresh the authenticated landing page.", "The user remains authenticated and the page reloads successfully."],
    ["Verify direct protected-route access before authentication", "Security", "Critical", "Automation", "Clear the session and open a discovered protected route directly.", "The app redirects to login or denies access without exposing protected data."],
    ["Verify logout from an authenticated session", "Security", "Critical", "Automation", "Log in and activate the logout control.", "The session is cleared and the login page is shown."],
    ["Verify browser Back after logout does not expose protected content", "Security", "Critical", "Automation", "Log out and use the browser Back button.", "Protected content is not displayed from cache and the user remains unauthenticated."],
    ["Verify expired session behavior", "Security", "Critical", "Partial Automation", "Expire or remove the session token and open a protected page.", "The app redirects to login or shows a safe expired-session message."],
    ["Verify authenticated session behavior across multiple tabs", "End-to-End", "High", "Manual", "Log in, open a second tab, then log out from one tab.", "Both tabs consistently reflect the session state after refresh or navigation."],
    ["Verify concurrent Super Admin sessions behave consistently", "Security", "High", "Manual", "Log in as Super Admin from two browser sessions.", "The application follows the configured concurrent-session policy without data leakage."],
  ];

  for (const [subject, testType, priority, automation, action, expected] of authCases) {
    addCase(state, {
      subject,
      description: `${subject.replace(/^Verify\s+/i, "This case verifies ")} on the LSM login page so authentication failures and session creation are controlled.`,
      priority,
      category: "Authentication",
      testType,
      language: "Both",
      automation,
      testSteps: steps(
        "Navigate to the LSM login page.",
        action,
        "Submit the login form.",
        "Observe the login response, visible validation, URL, and session state.",
      ),
      expectedResult: expected,
      note: `URL: ${loginUrl}; Module: Authentication`,
    });
  }
}

function addNavigationCases(state, page) {
  const title = pageTitle(page);
  addCase(state, {
    subject: `Verify navigation to ${title}`,
    description: `Validates that the discovered ${pageModule(page)} page can be opened from its actual route and presents the expected page identity.`,
    priority: "High",
    category: "Navigation",
    testType: "Functional",
    automation: "Automation",
    testSteps: steps(
      "Log in as Super Admin.",
      `Navigate to the discovered route ${displayUrl(page.url)}.`,
      "Wait for page data and navigation controls to load.",
      "Verify the page title, heading, and protected navigation are visible.",
    ),
    expectedResult: `${title} opens successfully, remains within the LSM application, and does not redirect to the login page.`,
    note: pageNote(page),
  });

  addCase(state, {
    subject: `Verify direct URL access for ${title}`,
    description: `Checks direct authenticated access to the real ${pageModule(page)} route so bookmarked or shared URLs remain reliable.`,
    priority: "High",
    category: "Navigation",
    testType: "Regression",
    automation: "Automation",
    testSteps: steps(
      "Log in as Super Admin.",
      `Open ${page.url} directly in the browser address bar.`,
      "Wait for the page to finish loading.",
      "Verify the displayed module and page state.",
    ),
    expectedResult: "The route loads the same protected page state without duplicate redirects or missing navigation.",
    note: pageNote(page),
  });

  addCase(state, {
    subject: `Verify refresh behavior on ${title}`,
    description: `Ensures the discovered ${pageModule(page)} page survives browser refresh without losing the authenticated route.`,
    priority: "Medium",
    category: "Navigation",
    testType: "Regression",
    automation: "Automation",
    testSteps: steps(
      "Log in as Super Admin.",
      `Navigate to ${title}.`,
      "Refresh the browser.",
      "Observe the URL, page content, and navigation state after reload.",
    ),
    expectedResult: "The page reloads successfully, preserves the route, and reloads required data.",
    note: pageNote(page),
  });

  if (safeArray(page.breadcrumbs).length > 0) {
    addCase(state, {
      subject: `Verify breadcrumbs on ${title}`,
      description: `Validates the breadcrumb trail discovered on ${title} for location awareness and parent navigation.`,
      priority: "Medium",
      category: "Navigation",
      testType: "Functional",
      automation: "Automation",
      testSteps: steps(
        `Open ${title}.`,
        "Review the visible breadcrumb labels and links.",
        "Click each safe parent breadcrumb.",
        "Return to the original page.",
      ),
      expectedResult: "Breadcrumb labels match the current hierarchy and safe breadcrumb links navigate to the expected parent pages.",
      note: pageNote(page, `Breadcrumbs: ${safeArray(page.breadcrumbs).map((b) => b.text).filter(Boolean).join(" > ")}`),
    });
  }

  for (const tab of safeArray(page.tabs)) {
    const tabText = compactText(tab.text || tab.label || tab.ariaLabel, "tab");
    addCase(state, {
      subject: `Verify ${tabText} tab on ${title}`,
      description: `Checks the discovered ${tabText} tab within ${title} because tabbed content often exposes secondary workflow fields or tables.`,
      priority: "Medium",
      category: "Navigation",
      testType: "Functional",
      automation: "Automation",
      testSteps: steps(
        `Open ${title}.`,
        `Select the ${tabText} tab.`,
        "Wait for tab content and any API request to complete.",
        "Verify the selected tab remains active and its content is visible.",
      ),
      expectedResult: `The ${tabText} tab becomes active and displays its related content without page errors.`,
      note: pageNote(page),
    });
  }
}

function addDashboardCases(state, page) {
  const title = pageTitle(page);
  const hasDashboardSignals =
    /dashboard|home|لوحة|الرئيس/i.test(`${page.url} ${title} ${pageModule(page)}`) ||
    safeArray(page.cards).length > 0 ||
    safeArray(page.charts).length > 0;
  if (!hasDashboardSignals) {
    return;
  }

  for (const [index, card] of safeArray(page.cards).entries()) {
    const cardTitle = compactText(card.title || card.text, `dashboard card ${index + 1}`);
    addCase(state, {
      subject: `Verify dashboard card ${cardTitle} on ${title}`,
      description: `Validates the discovered dashboard card or statistic ${cardTitle} on ${title}, including label visibility and value loading.`,
      priority: "High",
      category: "Dashboard",
      testType: "Functional",
      automation: "Automation",
      testSteps: steps(
        `Open ${title}.`,
        `Locate the ${cardTitle} card.`,
        "Wait for dashboard data APIs to complete.",
        "Verify the card label, value, and any linked action.",
      ),
      expectedResult: `${cardTitle} is visible, displays a valid value or empty state, and its link opens the expected module when available.`,
      note: pageNote(page),
    });
  }

  for (const [index, chart] of safeArray(page.charts).entries()) {
    const chartTitle = compactText(chart.title || chart.ariaLabel || chart.selector, `chart ${index + 1}`);
    addCase(state, {
      subject: `Verify dashboard chart ${chartTitle} on ${title}`,
      description: `Checks the discovered chart ${chartTitle} on ${title} for labels, rendering, tooltip behavior, and data-loading reliability.`,
      priority: "Medium",
      category: "Dashboard",
      testType: "Functional",
      automation: "Partial Automation",
      testSteps: steps(
        `Open ${title}.`,
        `Locate ${chartTitle}.`,
        "Hover or focus chart data points when supported.",
        "Compare visible labels and series with the dashboard API response.",
      ),
      expectedResult: "The chart renders without blank regions, labels are readable, and tooltips match the loaded data.",
      note: pageNote(page, "Visual chart accuracy may require manual judgment."),
    });
  }

  for (const filter of safeArray(page.filters)) {
    const filterText = compactText(filter.text || filter.label || filter.placeholder, "dashboard filter");
    addCase(state, {
      subject: `Verify dashboard filter ${filterText} on ${title}`,
      description: `Ensures the dashboard filter ${filterText} updates the dashboard widgets without stale values.`,
      priority: "Medium",
      category: "Dashboard",
      testType: "Integration",
      automation: "Automation",
      testSteps: steps(
        `Open ${title}.`,
        `Apply the ${filterText} filter.`,
        "Wait for dashboard requests to complete.",
        "Verify cards, charts, and empty states update consistently.",
      ),
      expectedResult: "Dashboard data refreshes according to the selected filter and no unrelated widget remains stale.",
      note: pageNote(page),
    });
  }
}

function addFormCases(state, page) {
  const title = pageTitle(page);
  const forms = collectForms(page);
  forms.forEach((form, formIndex) => {
    const formName = compactText(form.title || form.name || form.selector, `${title} form ${formIndex + 1}`);
    const fields = safeArray(form.fields).length > 0 ? safeArray(form.fields) : collectFields(page);
    const hasSubmit = collectActions(page).some((action) => actionKind(action) === "submit");
    const hasCancel = collectActions(page).some((action) => actionKind(action) === "cancel");
    const hasReset = collectActions(page).some((action) => actionKind(action) === "reset");

    addCase(state, {
      subject: `Verify valid submission for ${formName}`,
      description: `Validates a positive path for the discovered ${formName} on ${title} using timestamped Cypress test data when the module supports safe creation or update.`,
      priority: "High",
      category: "Forms",
      testType: "Positive",
      automation: hasSubmit ? "Partial Automation" : "Manual",
      testSteps: steps(
        `Open ${title}.`,
        `Open or focus ${formName}.`,
        "Enter valid timestamped values in all required fields.",
        "Submit the form only when it targets a Cypress-created temporary record.",
        "Verify the success message and clean up the temporary record when supported.",
      ),
      expectedResult: "The form accepts valid data, displays a success message, prevents duplicate requests, and stores only the intended temporary record.",
      note: pageNote(page, hasSubmit ? "Automation must use Cypress test data and cleanup." : "No submit action was detected during discovery."),
    });

    addCase(state, {
      subject: `Verify server failure handling for ${formName}`,
      description: `Checks that ${formName} displays a safe error when the save API fails and does not leave partial UI state.`,
      priority: "High",
      category: "Forms",
      testType: "API",
      automation: "Automation",
      testSteps: steps(
        `Open ${title}.`,
        `Populate ${formName} with valid temporary data.`,
        "Intercept the submit API and return a server error.",
        "Submit the form once.",
        "Observe the error message and form values.",
      ),
      expectedResult: "A user-safe error is displayed, entered values remain available for correction, and no success state is shown.",
      note: pageNote(page),
    });

    addCase(state, {
      subject: `Verify duplicate submission prevention for ${formName}`,
      description: `Ensures ${formName} does not send duplicate save requests when the user double-clicks or presses Enter repeatedly.`,
      priority: "High",
      category: "Forms",
      testType: "Reliability",
      automation: hasSubmit ? "Automation" : "Manual",
      testSteps: steps(
        `Open ${title}.`,
        `Populate ${formName} with valid temporary data.`,
        "Double-click the submit control or submit twice rapidly.",
        "Inspect the network requests and visible result.",
      ),
      expectedResult: "Only one create or update request is accepted and the UI prevents duplicate records.",
      note: pageNote(page),
    });

    if (hasCancel) {
      addCase(state, {
        subject: `Verify cancel behavior for ${formName}`,
        description: `Validates that the cancel action on ${formName} exits without saving changed values.`,
        priority: "Medium",
        category: "Forms",
        testType: "Functional",
        automation: "Automation",
        testSteps: steps(
          `Open ${title}.`,
          `Enter unsaved values in ${formName}.`,
          "Click Cancel.",
          "Confirm discard only if a safe confirmation is displayed.",
          "Reopen the form or list view.",
        ),
        expectedResult: "Unsaved values are discarded and no create or update API request is sent.",
        note: pageNote(page),
      });
    }

    if (hasReset) {
      addCase(state, {
        subject: `Verify reset behavior for ${formName}`,
        description: `Checks that the reset action restores defaults on the discovered ${formName}.`,
        priority: "Medium",
        category: "Forms",
        testType: "Functional",
        automation: "Automation",
        testSteps: steps(
          `Open ${title}.`,
          `Change several fields in ${formName}.`,
          "Click Reset or Clear.",
          "Inspect field values, required-state indicators, and validation messages.",
        ),
        expectedResult: "Fields return to their default values and validation state is reset without submitting data.",
        note: pageNote(page),
      });
    }

    fields.forEach((field, fieldIndex) => {
      addFieldCases(state, page, formName, field, fieldIndex);
    });
  });
}

function addFieldCases(state, page, formName, field, fieldIndex) {
  const title = pageTitle(page);
  const fieldName = describeField(field, fieldIndex);
  const required = Boolean(field.required || field.ariaRequired);

  if (required) {
    addCase(state, {
      subject: `Verify required validation for ${fieldName} on ${formName}`,
      description: `Validates that the required discovered field ${fieldName} cannot be omitted on ${title}.`,
      priority: "High",
      category: "Forms",
      testType: "Validation",
      automation: "Automation",
      testSteps: steps(
        `Open ${title}.`,
        `Open ${formName}.`,
        `Leave ${fieldName} empty while entering valid values in other required fields.`,
        "Submit or move focus away from the field.",
      ),
      expectedResult: `${fieldName} displays a required-field validation message and the form is not saved.`,
      note: pageNote(page, `Field selector: ${field.selector || ""}`),
    });
  }

  const genericFieldCases = [
    ["maximum length", "Enter a value longer than the allowed maximum or a long 300-character string.", "The field rejects the value or shows a clear maximum-length validation.", "Validation", "Medium"],
    ["minimum length", "Enter a one-character value when the field expects a longer value.", "The field shows minimum-length validation when applicable.", "Validation", "Medium"],
    ["leading and trailing spaces", "Enter the value with leading and trailing spaces.", "The app trims safely or preserves spaces according to business rules without creating duplicates.", "Validation", "Medium"],
    ["special characters", "Enter punctuation and symbols such as <>&'\".", "The app stores or rejects the value safely without script execution or layout breakage.", "Security", "Critical"],
    ["Arabic text", `Enter ${ARABIC_SAMPLE}.`, "Arabic text is accepted where allowed and displayed correctly in RTL contexts.", "Localization", "Medium"],
    ["English text", `Enter ${ENGLISH_SAMPLE}.`, "English text is accepted where allowed and displayed correctly in LTR contexts.", "Localization", "Medium"],
    ["mixed-language text", `Enter ${MIXED_SAMPLE}.`, "Mixed Arabic and English content remains readable and searchable.", "Localization", "Medium"],
    ["copy and paste", "Paste a valid value into the field.", "The pasted value is accepted and validated the same as typed input.", "Functional", "Low"],
  ];

  for (const [label, action, expected, testType, priority] of genericFieldCases) {
    addCase(state, {
      subject: `Verify ${label} handling for ${fieldName} on ${formName}`,
      description: `Checks ${label} behavior for the actual discovered field ${fieldName} on ${title}.`,
      priority,
      category: "Forms",
      testType,
      language: label.includes("Arabic") || label.includes("mixed") ? "Both" : "English",
      automation: "Automation",
      testSteps: steps(
        `Open ${title}.`,
        `Open ${formName}.`,
        action,
        "Move focus away or submit the form when safe.",
        "Observe field validation and displayed value.",
      ),
      expectedResult: expected,
      note: pageNote(page, `Field type: ${fieldType(field)}; Selector: ${field.selector || ""}`),
    });
  }

  if (fieldIsNumeric(field)) {
    for (const [valueLabel, value, expected] of [
      ["negative value", "-1", "The field rejects negative values when not valid for the business rule."],
      ["zero value", "0", "The field accepts zero only when it is valid for the business rule and otherwise shows validation."],
      ["decimal value", "10.50", "The field applies the configured decimal precision and validation."],
      ["very large value", "999999999999", "The field enforces numeric bounds without overflow or formatting errors."],
    ]) {
      addCase(state, {
        subject: `Verify ${valueLabel} validation for ${fieldName}`,
        description: `Validates numeric boundary handling for the discovered ${fieldName} field on ${title}.`,
        priority: "Medium",
        category: "Forms",
        testType: "Validation",
        automation: "Automation",
        testSteps: steps(
          `Open ${title}.`,
          `Enter ${value} in ${fieldName}.`,
          "Submit or move focus away.",
          "Observe numeric validation and formatting.",
        ),
        expectedResult: expected,
        note: pageNote(page),
      });
    }
  }

  if (fieldIsEmail(field)) {
    addCase(state, {
      subject: `Verify invalid email format validation for ${fieldName}`,
      description: `Checks email format validation for the discovered ${fieldName} field on ${title}.`,
      priority: "High",
      category: "Forms",
      testType: "Validation",
      automation: "Automation",
      testSteps: steps(
        `Open ${title}.`,
        `Enter invalid-email in ${fieldName}.`,
        "Submit or move focus away.",
        "Observe email validation.",
      ),
      expectedResult: `${fieldName} rejects the invalid email format and displays a clear validation message.`,
      note: pageNote(page),
    });
  }

  if (field.readOnly || field.disabled) {
    addCase(state, {
      subject: `Verify ${field.disabled ? "disabled" : "read-only"} behavior for ${fieldName}`,
      description: `Ensures the discovered ${fieldName} field cannot be edited when marked ${field.disabled ? "disabled" : "read-only"}.`,
      priority: "Medium",
      category: "Forms",
      testType: "Functional",
      automation: "Automation",
      testSteps: steps(
        `Open ${title}.`,
        `Locate ${fieldName}.`,
        "Attempt to focus and change the value.",
        "Observe whether the value changes or a request is sent.",
      ),
      expectedResult: `${fieldName} remains non-editable and no unauthorized value change is submitted.`,
      note: pageNote(page),
    });
  }
}

function addCrudCases(state, page) {
  const title = pageTitle(page);
  const actions = collectActions(page);
  const kinds = new Set(actions.map(actionKind));
  const crudDefinitions = [
    ["create", "Create", "Create a timestamped Cypress test record using valid discovered fields.", "The record is created once, visible in the relevant list, and can be cleaned up safely.", "High"],
    ["view", "View", "Open the view/details action for an existing row or card.", "The details page or modal shows read-only record information consistent with the list.", "High"],
    ["edit", "Edit", "Open the edit action for a Cypress-created or safe test record and change a non-critical field.", "The update succeeds, audit or modified data is reflected, and existing records are not overwritten.", "High"],
    ["delete", "Delete", "Open delete for a Cypress-created temporary record and cancel first, then confirm only for the test record.", "The confirmation dialog appears, cancel keeps the record, and confirmed deletion removes only the test record.", "Critical"],
    ["archive", "Archive", "Archive a Cypress-created temporary record when archive is available.", "The record status changes to archived and can be found with archived filters.", "High"],
    ["restore", "Restore", "Restore a Cypress-created archived record when restore is available.", "The record returns to the active list without duplicate records.", "High"],
    ["activate", "Activate", "Activate a Cypress-created inactive record when activate is available.", "The record becomes active and active-only views include it.", "High"],
    ["deactivate", "Deactivate", "Deactivate a Cypress-created active record when deactivate is available.", "The record becomes inactive without affecting existing users or permissions.", "Critical"],
  ];

  for (const [kind, label, actionStep, expected, priority] of crudDefinitions) {
    if (!kinds.has(kind)) {
      continue;
    }
    addCase(state, {
      subject: `Verify ${label.toLowerCase()} operation in ${pageModule(page)} - ${title}`,
      description: `Validates the discovered ${label.toLowerCase()} capability on ${title} while respecting safe exploration rules and using temporary Cypress data when changes are required.`,
      priority,
      category: "CRUD operations",
      testType: kind === "delete" || kind === "deactivate" ? "Security" : "End-to-End",
      automation: kind === "delete" || kind === "deactivate" ? "Partial Automation" : "Automation",
      testSteps: steps(
        `Open ${title}.`,
        actionStep,
        "Validate the UI message, API response, and list/detail state.",
        "Refresh the page and verify the final record state.",
      ),
      expectedResult: expected,
      note: pageNote(page, `${label} action discovered. Destructive actions must use only Cypress-created data.`),
    });
  }

  if (kinds.has("delete") || kinds.has("archive") || kinds.has("deactivate") || kinds.has("approve") || kinds.has("reject")) {
    addCase(state, {
      subject: `Verify confirmation dialog for protected actions on ${title}`,
      description: `Checks that high-impact actions discovered on ${title} require explicit confirmation and can be cancelled safely.`,
      priority: "Critical",
      category: "CRUD operations",
      testType: "Security",
      automation: "Automation",
      testSteps: steps(
        `Open ${title}.`,
        "Open a protected action for a Cypress-created or safe record.",
        "Verify the confirmation dialog text and buttons.",
        "Cancel the action.",
        "Verify no state-changing API request is completed.",
      ),
      expectedResult: "The confirmation dialog is clear, cancellation leaves the record unchanged, and no irreversible operation runs accidentally.",
      note: pageNote(page),
    });
  }
}

function addTableCases(state, page) {
  const title = pageTitle(page);
  collectTables(page).forEach((table, tableIndex) => {
    const tableName = describeTable(table, tableIndex);
    const columns = safeArray(table.columns);
    const common = [
      ["data loading", "Open the page and wait for the table API.", "The table shows loaded rows or a clear empty state without console errors.", "High", "Functional"],
      ["correct columns", "Compare the table headers with the discovered column list.", `The table displays the expected columns: ${columns.length ? columns.join(", ") : "discovered headers"}.`, "High", "Functional"],
      ["empty state", "Intercept the table API with an empty response.", "The table displays a clear empty-state message without broken pagination.", "Medium", "API"],
      ["search", "Enter a valid full or partial value in the table search field.", "Rows update to match the search and the search request or client filter uses the entered value.", "Medium", "Functional"],
      ["partial search", "Enter the first few characters of a known row value.", "Rows containing the partial value remain visible.", "Medium", "Functional"],
      ["exact search", "Enter the complete value of a known row field.", "The matching row is visible and unrelated rows are hidden or ranked lower.", "Medium", "Functional"],
      ["case-insensitive search", "Search using a different letter case.", "Search behavior follows the application rules consistently without missing valid records.", "Medium", "Functional"],
      ["Arabic search", `Search for ${ARABIC_SAMPLE}.`, "Arabic text is handled correctly and no encoding issue appears.", "Medium", "Localization"],
      ["special-character search", "Search using special characters such as <>&'\".", "The app handles the search safely without injection or UI errors.", "Critical", "Security"],
      ["filter application", "Apply each discovered table filter one at a time.", "The table refreshes according to the selected filter.", "Medium", "Functional"],
      ["multiple filters", "Apply two or more compatible filters.", "The table combines filters correctly and displays a clear result state.", "Medium", "Functional"],
      ["clear filters", "Clear all applied filters.", "The table returns to the unfiltered result set.", "Medium", "Functional"],
      ["pagination next page", "Click Next page when more than one page exists.", "The next result page loads and the current page indicator updates.", "Medium", "Functional"],
      ["pagination previous page", "Navigate to the second page and click Previous.", "The previous result page loads and page numbering is correct.", "Medium", "Functional"],
      ["page size", "Change the page size when a selector is available.", "The visible row count and API pagination parameters match the selected page size.", "Medium", "Functional"],
      ["refresh", "Refresh the browser while the table is visible.", "The table reloads with the same route and no duplicated rows.", "Medium", "Regression"],
      ["row action menu", "Open the row action menu for a safe record.", "Available row actions match the user's permissions and no action is triggered merely by opening the menu.", "High", "Functional"],
      ["responsive scrolling", "Resize to tablet and mobile widths.", "Columns remain usable with horizontal scroll or responsive layout and no text overlap.", "Medium", "Responsive"],
      ["permission-based columns", "Compare visible columns with a lower-privilege role where available.", "Sensitive columns are hidden from roles without permission.", "Critical", "Security"],
    ];

    for (const [label, action, expected, priority, testType] of common) {
      addCase(state, {
        subject: `Verify ${label} for ${tableName} on ${title}`,
        description: `Validates ${label} behavior for the discovered ${tableName} table in ${pageModule(page)}.`,
        priority,
        category: "Tables",
        testType,
        language: label.includes("Arabic") ? "Both" : "English",
        automation: label.includes("permission") ? "Partial Automation" : "Automation",
        testSteps: steps(
          `Open ${title}.`,
          `Locate ${tableName}.`,
          action,
          "Observe rows, headers, pagination, and network requests.",
        ),
        expectedResult: expected,
        note: pageNote(page),
      });
    }

    columns.forEach((column) => {
      addCase(state, {
        subject: `Verify sorting by ${column} in ${tableName}`,
        description: `Checks the discovered ${column} column sorting behavior in ${tableName} on ${title}.`,
        priority: "Medium",
        category: "Tables",
        testType: "Functional",
        automation: "Automation",
        testSteps: steps(
          `Open ${title}.`,
          `Click the ${column} column sort control if available.`,
          "Verify ascending order.",
          `Click ${column} again.`,
          "Verify descending order or the configured unsorted state.",
        ),
        expectedResult: `${column} sorting updates row order and API sort parameters consistently.`,
        note: pageNote(page),
      });
    });
  });
}

function addDropdownCases(state, page) {
  const title = pageTitle(page);
  const selectors = [
    ...safeArray(page.selectLists),
    ...safeArray(page.dropdowns),
    ...collectActions(page).filter((action) => action.hasPopup || actionKind(action) === "filter"),
  ];

  uniqueBy(selectors, (item, index) => compactText(`${item.selector || ""}|${item.name || ""}|${describeField(item, index)}|${describeAction(item, index)}`)).forEach(
    (selector, index) => {
      const selectorName = compactText(describeField(selector, index) || describeAction(selector, index), `selector ${index + 1}`);
      for (const [label, action, expected, priority, testType] of [
        ["open and close", "Open the dropdown, then close it using Escape and outside click.", "The dropdown opens and closes without changing the selected value.", "Medium", "Functional"],
        ["available values", "Open the dropdown and capture the visible options.", "The options match the available values returned by the UI or API.", "Medium", "Functional"],
        ["default selection", "Inspect the initial selected value.", "The default selection is correct for the page state and placeholder is shown when no value is selected.", "Medium", "Functional"],
        ["searchable dropdown", "Type inside the dropdown search when available.", "Options filter according to the typed value and no-result state appears when nothing matches.", "Medium", "Functional"],
        ["keyboard navigation", "Use Arrow keys, Enter, and Escape in the dropdown.", "Keyboard navigation moves focus and selection predictably.", "Medium", "Accessibility"],
        ["required selection", "Clear the required selection and submit when safe.", "A required-selection validation message is displayed.", "High", "Validation"],
        ["clear selection", "Use the clear control when available.", "The selection is cleared and dependent fields update.", "Medium", "Functional"],
        ["disabled options", "Inspect disabled options and attempt to select one.", "Disabled options cannot be selected.", "Medium", "Functional"],
        ["dependent dropdowns", "Change the parent selector value.", "Dependent dropdown options refresh and stale selections are cleared.", "Medium", "Integration"],
        ["long labels", "Open options with long labels or create a long test label when safe.", "Long labels wrap or truncate without overlapping other UI.", "Low", "Responsive"],
        ["Arabic labels", `Verify options containing ${ARABIC_SAMPLE}.`, "Arabic labels render correctly and can be selected or searched.", "Medium", "Localization"],
        ["API failure", "Intercept the dropdown options API with an error response.", "The dropdown shows a safe error or empty state and does not break the form.", "High", "API"],
      ]) {
        addCase(state, {
          subject: `Verify ${label} for ${selectorName} on ${title}`,
          description: `Validates ${label} behavior for the discovered dropdown or selector ${selectorName} in ${pageModule(page)}.`,
          priority,
          category: "Dropdowns and selectors",
          testType,
          language: label.includes("Arabic") ? "Both" : "English",
          automation: testType === "Accessibility" ? "Partial Automation" : "Automation",
          testSteps: steps(
            `Open ${title}.`,
            `Locate ${selectorName}.`,
            action,
            "Observe value, option list, validation, and API behavior.",
          ),
          expectedResult: expected,
          note: pageNote(page),
        });
      }
    },
  );
}

function addDateAndFileCases(state, page) {
  const title = pageTitle(page);
  safeArray(page.dateFields).forEach((field, index) => {
    const fieldName = describeField(field, index);
    for (const [label, action, expected, priority] of [
      ["valid date", "Enter a valid date using the expected format.", "The date is accepted and displayed consistently.", "High"],
      ["invalid date", "Enter an invalid date such as 31/02/2026.", "The field rejects the invalid date with a clear validation message.", "High"],
      ["past date", "Enter a past date.", "The field accepts or rejects the past date according to the business rule.", "Medium"],
      ["future date", "Enter a future date.", "The field accepts or rejects the future date according to the business rule.", "Medium"],
      ["start date after end date", "Enter a start date later than the end date when a paired end date exists.", "A date-range validation message is shown.", "High"],
      ["same start and end dates", "Enter the same date for start and end when a range exists.", "The app handles same-day ranges according to business rules.", "Medium"],
      ["leap year", "Enter 29/02/2024.", "Leap-year dates are parsed and stored correctly.", "Medium"],
      ["month boundary", "Enter the last day of a month and the first day of the next month.", "Month boundary dates are handled without off-by-one errors.", "Medium"],
      ["calendar picker", "Select a date from the calendar picker.", "The selected picker value is written to the field in the correct format.", "Medium"],
      ["time-zone consistency", "Save or filter with the selected date and compare API and UI values.", "The date remains consistent without unwanted time-zone shifts.", "High"],
      ["Arabic date display", "Switch to Arabic when available and inspect the date display.", "Arabic date display is readable and aligned with RTL layout.", "Medium"],
    ]) {
      addCase(state, {
        subject: `Verify ${label} for ${fieldName} on ${title}`,
        description: `Checks ${label} handling for the discovered date/time field ${fieldName} on ${title}.`,
        priority,
        category: "Date and time fields",
        testType: label.includes("Arabic") ? "Localization" : "Validation",
        language: label.includes("Arabic") ? "Arabic" : "Both",
        automation: label.includes("time-zone") ? "Partial Automation" : "Automation",
        testSteps: steps(
          `Open ${title}.`,
          `Locate ${fieldName}.`,
          action,
          "Observe validation, displayed value, and API payload when submitted safely.",
        ),
        expectedResult: expected,
        note: pageNote(page),
      });
    }
  });

  safeArray(page.fileUploadFields).forEach((field, index) => {
    const fieldName = describeField(field, index);
    for (const [label, action, expected, priority, automation] of [
      ["valid image upload", "Upload a small valid PNG or JPG test file.", "The image is accepted, previewed, and stored only for the temporary test record.", "High", "Automation"],
      ["multiple image upload", "Upload multiple valid images when the field allows multiple files.", "All files are listed or unsupported multiple selection is blocked clearly.", "Medium", "Automation"],
      ["file preview", "Upload a valid image and inspect the preview.", "The preview displays the selected file without broken image indicators.", "Medium", "Partial Automation"],
      ["replace file", "Upload a valid file, then replace it with another valid file.", "Only the replacement file remains selected or saved.", "Medium", "Automation"],
      ["remove file", "Upload a valid file and remove it before submitting.", "The file is removed and no upload request is sent for it.", "Medium", "Automation"],
      ["file-size limit", "Upload a file larger than the configured limit.", "The app rejects the file with a size validation message.", "High", "Automation"],
      ["unsupported extension", "Upload a file type that is not allowed.", "The app rejects the file type with a safe validation message.", "High", "Automation"],
      ["corrupted file", "Upload a corrupted image file.", "The app rejects or safely handles the corrupted file.", "High", "Automation"],
      ["duplicate filename", "Upload two files with the same filename when multiple files are supported.", "Duplicate names are handled consistently without overwriting unintended files.", "Medium", "Automation"],
      ["long filename", "Upload a file with a long filename.", "The filename is displayed without layout overlap and is safely stored or rejected.", "Low", "Automation"],
      ["Arabic filename", `Upload a file named ${ARABIC_SAMPLE}.png.`, "Arabic filenames remain readable and downloadable.", "Medium", "Automation"],
      ["special-character filename", "Upload a file with special characters in the filename.", "The filename is sanitized or rejected safely.", "High", "Security"],
      ["empty upload", "Submit the form without selecting a required file.", "Required upload validation is displayed when the file is mandatory.", "High", "Validation"],
      ["upload interruption", "Interrupt or fail the upload request.", "The UI shows an upload failure and allows retry without duplicate files.", "High", "API"],
      ["unauthorized file access", "Attempt to open an uploaded file URL without authorization.", "The file is not accessible to unauthorized sessions.", "Critical", "Security"],
      ["download", "Download the uploaded file when download is available.", "The downloaded file matches the uploaded file and uses a secure URL.", "Medium", "Partial Automation"],
      ["secure file URL", "Inspect file preview and download URLs.", "Sensitive tokens or local filesystem paths are not exposed in the URL.", "Critical", "Security"],
    ]) {
      addCase(state, {
        subject: `Verify ${label} for ${fieldName} on ${title}`,
        description: `Validates ${label} behavior for the discovered upload field ${fieldName} on ${title}.`,
        priority,
        category: "File and screenshot uploads",
        testType: label.includes("Security") ? "Security" : label.includes("API") ? "API" : "Functional",
        language: label.includes("Arabic") ? "Both" : "English",
        automation,
        testSteps: steps(
          `Open ${title}.`,
          `Locate ${fieldName}.`,
          action,
          "Observe validation, preview, request, and saved state when submission is safe.",
        ),
        expectedResult: expected,
        note: pageNote(page, "Upload tests must use harmless Cypress fixture files only."),
      });
    }
  });
}

function addWorkflowCases(state, page) {
  const title = pageTitle(page);
  const actions = collectActions(page);
  const kinds = new Set(actions.map(actionKind));
  const statuses = safeArray(page.statusValues).map((status) => compactText(status.text || status.value || status)).filter(Boolean);
  if (!kinds.has("approve") && !kinds.has("reject") && statuses.length === 0) {
    return;
  }

  for (const status of statuses.slice(0, 20)) {
    addCase(state, {
      subject: `Verify status display ${status} on ${title}`,
      description: `Checks the discovered workflow/status value ${status} on ${title} for label, color, filtering, and record-state consistency.`,
      priority: "High",
      category: "Workflows and statuses",
      testType: "Functional",
      automation: "Automation",
      testSteps: steps(
        `Open ${title}.`,
        `Locate records or badges with status ${status}.`,
        "Apply status filters when available.",
        "Open a matching record and compare detail status.",
      ),
      expectedResult: `${status} is displayed consistently across list, detail, filter, and API response.`,
      note: pageNote(page),
    });
  }

  for (const [label, kind, expected] of [
    ["approval", "approve", "The record moves to the approved state, history is updated, and duplicate approval is blocked."],
    ["rejection", "reject", "The record moves to the rejected state only when required rejection fields are supplied."],
    ["cancellation", "cancel", "The record remains unchanged when cancellation is selected."],
  ]) {
    if (!kinds.has(kind)) {
      continue;
    }
    addCase(state, {
      subject: `Verify workflow ${label} on ${title}`,
      description: `Validates the discovered workflow ${label} action on ${title}, including required fields, confirmation, and resulting status.`,
      priority: "Critical",
      category: "Workflows and statuses",
      testType: "End-to-End",
      automation: "Partial Automation",
      testSteps: steps(
        `Open ${title}.`,
        "Select a Cypress-created or safe workflow record.",
        `Trigger the ${label} action.`,
        "Complete required transition fields when applicable.",
        "Verify status, history, notification behavior, and API response.",
      ),
      expectedResult: expected,
      note: pageNote(page, "Workflow actions must not be run against real business records."),
    });
  }
}

function addRolePermissionCases(state, page) {
  const title = pageTitle(page);
  const actions = collectActions(page);
  const securityActions = actions.filter((action) => ["create", "edit", "delete", "approve", "export"].includes(actionKind(action)));

  for (const role of ROLE_NAMES) {
    addCase(state, {
      subject: `Verify ${role} page access for ${title}`,
      description: `Checks whether the ${role} role should access the real discovered ${title} route and verifies direct URL protection.`,
      priority: role === "Super Admin" ? "High" : "Critical",
      category: "Roles and permissions",
      testType: "Security",
      automation: role === "Super Admin" ? "Automation" : "Manual",
      testSteps: steps(
        `Sign in as ${role}.`,
        `Open ${page.url} directly.`,
        "Observe page access, navigation visibility, and API responses.",
        "Attempt to refresh the same route.",
      ),
      expectedResult:
        role === "Super Admin"
          ? `${role} can access ${title} and use authorized controls.`
          : `${role} sees only authorized content; restricted pages redirect or show an access-denied state without exposing data.`,
      note: pageNote(page, role === "Super Admin" ? "" : "Requires a safe user for this role; do not change real permissions automatically."),
    });
  }

  securityActions.forEach((action, index) => {
    const actionText = describeAction(action, index);
    for (const role of ROLE_NAMES.filter((roleName) => roleName !== "Super Admin").slice(0, 5)) {
      addCase(state, {
        subject: `Verify ${role} permission for ${actionText} on ${title}`,
        description: `Validates role-based visibility and API enforcement for the discovered ${actionText} action on ${title}.`,
        priority: "Critical",
        category: "Roles and permissions",
        testType: "Security",
        automation: "Manual",
        testSteps: steps(
          `Sign in as ${role}.`,
          `Open ${title}.`,
          `Check whether ${actionText} is visible.`,
          "Attempt direct API access only in a safe test environment.",
        ),
        expectedResult: `${role} can see and execute ${actionText} only when explicitly authorized; direct API calls are denied otherwise.`,
        note: pageNote(page, "Permission validation requires safe role accounts and must not modify real permissions."),
      });
    }
  });
}

function addLocalizationCases(state, page) {
  const title = pageTitle(page);
  for (const [label, language, expected] of [
    ["English layout and labels", "English", "The page uses LTR alignment, English labels, and readable English validation text."],
    ["Arabic layout and labels", "Arabic", "The page uses RTL alignment, Arabic labels, and readable Arabic validation text."],
    ["language switching", "Both", "The page switches language without losing the current route or form state unexpectedly."],
    ["language persistence", "Both", "The selected language persists after refresh and authenticated navigation."],
    ["mixed-language content", "Both", "Arabic and English values display together without text overlap or direction issues."],
  ]) {
    addCase(state, {
      subject: `Verify ${label} on ${title}`,
      description: `Validates localization behavior for the discovered ${title} page, including labels, layout direction, and persisted language state.`,
      priority: "Medium",
      category: "Localization",
      testType: "Localization",
      language,
      automation: label.includes("layout") || label.includes("mixed") ? "Partial Automation" : "Automation",
      testSteps: steps(
        `Open ${title}.`,
        `Switch or confirm ${language} language mode.`,
        "Inspect headings, fields, tables, dropdowns, modals, numbers, and dates.",
        "Refresh or navigate away and back when testing persistence.",
      ),
      expectedResult: expected,
      note: pageNote(page),
    });
  }
}

function addResponsiveCases(state, page) {
  const title = pageTitle(page);
  for (const viewport of VIEWPORTS) {
    addCase(state, {
      subject: `Verify responsive layout for ${title} at ${viewport}`,
      description: `Checks the discovered ${title} page at ${viewport}, including navigation, forms, tables, modals, charts, and text overlap.`,
      priority: viewport.includes("mobile") ? "High" : "Medium",
      category: "Responsive testing",
      testType: "Responsive",
      automation: "Partial Automation",
      testSteps: steps(
        `Set the viewport to ${viewport}.`,
        `Open ${title}.`,
        "Inspect sidebar or mobile navigation behavior.",
        "Interact with visible forms, tables, cards, and modals where present.",
        "Check for horizontal overflow, hidden buttons, and text overlap.",
      ),
      expectedResult: "All visible controls remain reachable, text fits its containers, and responsive navigation behaves correctly.",
      note: pageNote(page, "Visual overlap checks may require screenshot review."),
    });
  }
}

function addAccessibilityCases(state, page) {
  const title = pageTitle(page);
  for (const [label, expected, automation] of [
    ["keyboard navigation and tab order", "Focus moves through interactive elements in a logical order and all actions are reachable by keyboard.", "Partial Automation"],
    ["visible focus indicators", "Focused controls have visible focus styling that is not clipped or hidden.", "Manual"],
    ["screen-reader labels for controls", "Inputs, buttons, links, and icons expose meaningful accessible names.", "Partial Automation"],
    ["heading hierarchy", "Headings follow a logical structure without skipped context for the current page.", "Automation"],
    ["color contrast", "Text and important controls meet contrast expectations in enabled, disabled, hover, and error states.", "Manual"],
    ["error announcements", "Validation errors are programmatically associated with fields and announced to assistive technologies.", "Manual"],
    ["modal focus trap and Escape key", "Dialog focus is trapped while open, returns to the trigger when closed, and Escape works when allowed.", "Partial Automation"],
    ["table headers", "Data cells are associated with table headers and sortable columns expose sort state.", "Automation"],
    ["zoom and text resizing", "The page remains usable at browser zoom and text-resize settings.", "Manual"],
  ]) {
    addCase(state, {
      subject: `Verify accessibility ${label} on ${title}`,
      description: `Accessibility validation for ${label} on the discovered ${title} page.`,
      priority: label.includes("keyboard") || label.includes("labels") ? "High" : "Medium",
      category: "Accessibility",
      testType: "Accessibility",
      automation,
      testSteps: steps(
        `Open ${title}.`,
        `Evaluate ${label}.`,
        "Use keyboard, DOM inspection, and assistive technology checks as applicable.",
        "Record any inaccessible control with selector and screenshot.",
      ),
      expectedResult: expected,
      note: pageNote(page, automation === "Manual" ? "Manual assistive-technology or visual verification required." : ""),
    });
  }
}

function addSecurityCases(state, page) {
  const title = pageTitle(page);
  addCase(state, {
    subject: `Verify unauthorized direct route protection for ${title}`,
    description: `Checks that the discovered protected route ${displayUrl(page.url)} does not expose data without a valid session.`,
    priority: "Critical",
    category: "Security",
    testType: "Security",
    automation: "Automation",
    testSteps: steps(
      "Clear all authenticated session storage and cookies.",
      `Open ${page.url} directly.`,
      "Observe the redirected page, response status, and visible content.",
    ),
    expectedResult: "The route redirects to login or access-denied state and protected data is not rendered.",
    note: pageNote(page),
  });

  addCase(state, {
    subject: `Verify sensitive data is not exposed in URL or storage on ${title}`,
    description: `Checks the discovered ${title} route for sensitive values in URLs, local storage, session storage, and visible errors.`,
    priority: "Critical",
    category: "Security",
    testType: "Security",
    automation: "Automation",
    testSteps: steps(
      `Open ${title}.`,
      "Inspect the current URL, browser storage, cookies metadata where available, and console-visible errors.",
      "Search for passwords, tokens in query strings, and sensitive personal data.",
    ),
    expectedResult: "Sensitive values are not exposed in URLs or unsafe storage and errors do not leak implementation details.",
    note: pageNote(page),
  });

  collectFields(page).forEach((field, index) => {
    const fieldName = describeField(field, index);
    for (const [label, payload, expected] of [
      ["XSS input handling", "<script>alert(1)</script>", "The payload is encoded or rejected and never executes."],
      ["HTML injection handling", "<b>Cypress</b>", "HTML is sanitized, encoded, or rejected according to field rules."],
      ["SQL injection-like string handling", "' OR '1'='1", "The app handles the string as data and does not expose database or server errors."],
    ]) {
      addCase(state, {
        subject: `Verify ${label} for ${fieldName} on ${title}`,
        description: `Safe security validation for the discovered ${fieldName} field on ${title} using a non-destructive payload.`,
        priority: "Critical",
        category: "Security",
        testType: "Security",
        automation: "Automation",
        testSteps: steps(
          `Open ${title}.`,
          `Enter ${payload} in ${fieldName}.`,
          "Submit only against a Cypress-created temporary record or use validation-only flow.",
          "Observe UI rendering, API response, and stored/displayed value.",
        ),
        expectedResult: expected,
        note: pageNote(page, "Do not run aggressive or destructive security testing."),
      });
    }
  });
}

function addApiCases(state, discovery) {
  const requests = safeArray(discovery.apiRequests).filter((request) => request.url && !/\.(js|css|png|jpg|jpeg|svg|woff|ico)(\?|$)/i.test(request.url));
  for (const [index, request] of requests.entries()) {
    const method = request.method || "GET";
    const endpoint = displayUrl(request.url);
    for (const [label, expected, priority, automation] of [
      ["HTTP method and status", `The ${method} request returns the expected success or handled error status.`, "High", "Automation"],
      ["request body and required properties", "The request includes only expected fields and all required properties are present.", "High", "Automation"],
      ["response structure", "The response schema contains the required properties used by the UI.", "High", "Automation"],
      ["unauthorized status", "Without a valid session the endpoint returns 401, 403, or a safe redirect response.", "Critical", "Automation"],
      ["slow response handling", "The UI shows loading state and recovers when the delayed response completes.", "Medium", "Automation"],
      ["failed response handling", "The UI shows a safe error state and does not display stale success data.", "High", "Automation"],
      ["duplicate request prevention", "The UI does not send unnecessary duplicate requests for the same action.", "Medium", "Automation"],
      ["UI consistency", "The UI data matches the API response values used to render the page.", "High", "Automation"],
    ]) {
      addCase(state, {
        subject: `Verify API ${label} for ${method} ${endpoint}`,
        description: `Validates the discovered API request ${method} ${endpoint} captured during LSM discovery.`,
        priority,
        category: "API validation",
        testType: "API",
        automation,
        testSteps: steps(
          "Log in as Super Admin.",
          `Trigger the UI action that calls ${method} ${endpoint}.`,
          "Capture the request and response with cy.intercept().",
          `Validate ${label}.`,
        ),
        expectedResult: expected,
        note: `URL: ${request.url}; Module: API; Status captured during discovery: ${request.statusCode ?? "unknown"}; API index: ${index + 1}`,
      });
    }
  }
}

function addPerformanceCases(state, page) {
  const title = pageTitle(page);
  for (const [label, action, expected, priority] of [
    ["page load", "Measure navigation from route open until main content and critical API requests complete.", "The page loads within the agreed threshold and shows useful loading indicators.", "High"],
    ["repeated navigation", "Navigate away and back to the page several times.", "The page does not leak state, duplicate rows, or accumulate failed requests.", "Medium"],
    ["slow API response", "Delay the page data API with cy.intercept().", "Loading indicators are visible and controls are disabled only as needed.", "Medium"],
    ["failed API response", "Return a controlled failure for the page data API.", "The page shows a safe error and retry or recovery path.", "High"],
    ["network interruption", "Simulate a network error while loading the page.", "The page handles interruption without blank or misleading content.", "High"],
    ["refresh during request", "Refresh while the page is loading a long-running request.", "The app cancels or recovers requests cleanly and renders the refreshed page.", "Medium"],
    ["concurrent tabs", "Open the route in two tabs and change safe test data in one tab.", "Both tabs remain consistent after refresh and no unauthorized overwrite occurs.", "Medium"],
  ]) {
    addCase(state, {
      subject: `Verify ${label} reliability for ${title}`,
      description: `Performance and reliability validation for ${label} on the discovered ${title} page.`,
      priority,
      category: "Performance and reliability",
      testType: "Performance",
      automation: label.includes("concurrent") ? "Manual" : "Automation",
      testSteps: steps(
        `Open ${title}.`,
        action,
        "Observe loading states, API requests, UI state, and final rendered content.",
      ),
      expectedResult: expected,
      note: pageNote(page),
    });
  }
}

function generateTestCases(discovery) {
  const state = { nextId: 1, cases: [] };
  const loginUrl = discovery.targetUrl || discovery.loginUrl || "https://lsm.nexumind.com/login";

  addAuthenticationCases(state, loginUrl);

  for (const page of discovery.pages) {
    addNavigationCases(state, page);
    addDashboardCases(state, page);
    addFormCases(state, page);
    addCrudCases(state, page);
    addTableCases(state, page);
    addDropdownCases(state, page);
    addDateAndFileCases(state, page);
    addWorkflowCases(state, page);
    addRolePermissionCases(state, page);
    addLocalizationCases(state, page);
    addResponsiveCases(state, page);
    addAccessibilityCases(state, page);
    addSecurityCases(state, page);
    addPerformanceCases(state, page);
  }

  addApiCases(state, discovery);

  return state.cases;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function validateCsvFile(filePath, expectedColumns = CSV_COLUMNS) {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(text);
  const header = rows[0] || [];
  const errors = [];

  if (header.length !== expectedColumns.length) {
    errors.push(`Expected ${expectedColumns.length} columns but found ${header.length}.`);
  }
  expectedColumns.forEach((column, index) => {
    if (header[index] !== column) {
      errors.push(`Column ${index + 1} expected "${column}" but found "${header[index] || ""}".`);
    }
  });

  const ids = new Set();
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row.length !== expectedColumns.length) {
      errors.push(`Row ${rowIndex + 1} has ${row.length} columns.`);
    }
    const idIndex = expectedColumns.indexOf("TC-ID");
    const id = row[idIndex];
    if (id) {
      if (ids.has(id)) {
        errors.push(`Duplicate TC-ID ${id}.`);
      }
      ids.add(id);
    }
    if (row.every((value) => value === "")) {
      errors.push(`Row ${rowIndex + 1} is blank.`);
    }
  }

  const stepsIndex = expectedColumns.indexOf("Test Steps");
  const hasMultilineSteps = rows.slice(1).some((row) => (row[stepsIndex] || "").includes("\n"));
  const hasArabic = /[\u0600-\u06ff]/.test(text);

  return {
    filePath,
    ok: errors.length === 0,
    errors,
    rowCount: Math.max(rows.length - 1, 0),
    columnCount: header.length,
    tcIdCount: ids.size,
    hasMultilineSteps,
    hasArabic,
  };
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtmlReport(discovery, cases, summary) {
  const modules = safeArray(discovery.modules).map((item) => `${item.module}${item.submodule ? ` / ${item.submodule}` : ""}`);
  const skipped = safeArray(discovery.skippedActions).slice(0, 100);
  const pages = safeArray(discovery.pages);
  const categoryCounts = {};
  for (const testCase of cases) {
    categoryCounts[testCase.Category] = (categoryCounts[testCase.Category] || 0) + 1;
  }

  const categoryRows = Object.entries(categoryCounts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, count]) => `<tr><td>${htmlEscape(category)}</td><td>${count}</td></tr>`)
    .join("");

  const pageRows = pages
    .map(
      (page) =>
        `<tr><td>${htmlEscape(pageModule(page))}</td><td>${htmlEscape(pageTitle(page))}</td><td><code>${htmlEscape(displayUrl(page.url))}</code></td><td>${collectForms(page).length}</td><td>${collectTables(page).length}</td><td>${collectActions(page).length}</td></tr>`,
    )
    .join("");

  const skippedRows = skipped.length
    ? skipped.map((item) => `<li>${htmlEscape(item.reason || "Skipped")} - ${htmlEscape(item.text || item.url || "")}</li>`).join("")
    : "<li>No unsafe page was visited; destructive actions were skipped.</li>";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>LSM Cypress Discovery Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #17202a; line-height: 1.45; }
    h1, h2 { margin: 0 0 12px; }
    section { margin: 28px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #d9dee5; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f3f6f9; }
    code { word-break: break-all; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .metric { border: 1px solid #d9dee5; padding: 12px; border-radius: 6px; background: #fbfcfe; }
    .metric strong { display: block; font-size: 24px; }
  </style>
</head>
<body>
  <h1>LSM Cypress Discovery Report</h1>
  <p>Generated at ${htmlEscape(new Date().toISOString())}</p>

  <section class="metrics">
    <div class="metric"><strong>${summary.routeCount}</strong>Routes discovered</div>
    <div class="metric"><strong>${summary.moduleCount}</strong>Modules discovered</div>
    <div class="metric"><strong>${summary.formCount}</strong>Forms discovered</div>
    <div class="metric"><strong>${summary.tableCount}</strong>Tables discovered</div>
    <div class="metric"><strong>${summary.totalTestCases}</strong>Total test cases</div>
    <div class="metric"><strong>${summary.automatedTestCases}</strong>Automated</div>
    <div class="metric"><strong>${summary.manualTestCases}</strong>Manual</div>
    <div class="metric"><strong>${summary.partialAutomationTestCases}</strong>Partial automation</div>
  </section>

  <section>
    <h2>Modules</h2>
    <p>${htmlEscape(modules.join(", ") || "No modules discovered.")}</p>
  </section>

  <section>
    <h2>Test Cases By Category</h2>
    <table><thead><tr><th>Category</th><th>Count</th></tr></thead><tbody>${categoryRows}</tbody></table>
  </section>

  <section>
    <h2>Discovered Pages</h2>
    <table><thead><tr><th>Module</th><th>Page</th><th>Route</th><th>Forms</th><th>Tables</th><th>Actions</th></tr></thead><tbody>${pageRows}</tbody></table>
  </section>

  <section>
    <h2>Safely Skipped Actions</h2>
    <ul>${skippedRows}</ul>
  </section>
</body>
</html>`;
}

function generateOutputs(rawDiscovery, options = {}) {
  const resultsDir = options.resultsDir || path.join(process.cwd(), "cypress", "results");
  ensureDir(resultsDir);

  const discovery = normalizeDiscovery(rawDiscovery);
  const cases = generateTestCases(discovery);
  const automatedCases = cases.filter((testCase) => testCase["Automation/Manual"] === "Automation");
  const manualCases = cases.filter((testCase) => testCase["Automation/Manual"] !== "Automation");

  const routeRows = discovery.routes.map((route, index) => ({
    "Route ID": `LSM-ROUTE-${String(index + 1).padStart(3, "0")}`,
    URL: route.url || route.normalizedUrl,
    "Normalized URL": route.normalizedUrl,
    "Route Pattern": route.routePattern,
    Module: route.module || "",
    Submodule: route.submodule || "",
    "Page Title": route.pageTitle || "",
    Source: route.source || "",
    "Dynamic Route": route.dynamicRoute ? "Yes" : "No",
    Visited: route.visited === false ? "No" : "Yes",
    "API Count": route.apiCount ?? 0,
  }));

  const summary = {
    routeCount: discovery.routes.length,
    moduleCount: discovery.modules.length,
    formCount: discovery.pages.reduce((count, page) => count + collectForms(page).length, 0),
    tableCount: discovery.pages.reduce((count, page) => count + collectTables(page).length, 0),
    totalTestCases: cases.length,
    automatedTestCases: automatedCases.length,
    manualTestCases: cases.filter((testCase) => testCase["Automation/Manual"] === "Manual").length,
    partialAutomationTestCases: cases.filter((testCase) => testCase["Automation/Manual"] === "Partial Automation").length,
    manualAndPartialFileCases: manualCases.length,
    skippedActionCount: safeArray(discovery.skippedActions).length,
    pagesNotSafelyExplored: safeArray(discovery.pagesNotSafelyExplored),
  };

  writeJson(path.join(resultsDir, "lsm-discovered-application.json"), {
    ...discovery,
    summary,
  });
  writeCsv(path.join(resultsDir, "lsm-discovered-routes.csv"), routeRows, ROUTE_COLUMNS);
  writeCsv(path.join(resultsDir, "LSM_All_Test_Cases.csv"), cases, CSV_COLUMNS);
  writeCsv(path.join(resultsDir, "LSM_Automated_Test_Cases.csv"), automatedCases, CSV_COLUMNS);
  writeCsv(path.join(resultsDir, "LSM_Manual_Test_Cases.csv"), manualCases, CSV_COLUMNS);
  fs.writeFileSync(path.join(resultsDir, "lsm-discovery-report.html"), renderHtmlReport(discovery, cases, summary), "utf8");

  const validations = [
    validateCsvFile(path.join(resultsDir, "LSM_All_Test_Cases.csv"), CSV_COLUMNS),
    validateCsvFile(path.join(resultsDir, "LSM_Automated_Test_Cases.csv"), CSV_COLUMNS),
    validateCsvFile(path.join(resultsDir, "LSM_Manual_Test_Cases.csv"), CSV_COLUMNS),
  ];

  return {
    ...summary,
    resultsDir,
    csvColumns: CSV_COLUMNS,
    validations,
  };
}

module.exports = {
  CSV_COLUMNS,
  ROUTE_COLUMNS,
  generateOutputs,
  validateCsvFile,
  normalizeDiscovery,
  renderCsv,
};
