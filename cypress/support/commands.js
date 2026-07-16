const LOGIN_PATH = Cypress.env("LSM_LOGIN_PATH") || "/login";
const PAGE_LOAD_TIMEOUT = Number(Cypress.env("LSM_PAGE_LOAD_TIMEOUT") || 180000);

const unsafeActionPattern =
  /(logout|log out|sign out|delete|remove|approve|reject|deactivate|disable|submit|save|send|bulk|حذف|إزالة|ازالة|موافقة|اعتماد|رفض|تعطيل|حفظ|إرسال|ارسال|تسجيل الخروج|خروج)/i;

const safeOpenPattern =
  /(menu|more|filter|search|view|details|show|open|add|new|create|edit|settings|tab|قائمة|المزيد|تصفية|بحث|عرض|تفاصيل|فتح|إضافة|اضافة|جديد|تعديل|إعدادات|اعدادات)/i;

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getLoginCredentials(overrides = {}) {
  return cy.fixture("lsm-test-data").then((data) => {
    const configured = data.credentials.superAdmin;
    return {
      username: overrides.username || Cypress.env("LSM_USERNAME") || configured.username,
      password: overrides.password || Cypress.env("LSM_PASSWORD") || configured.password,
    };
  });
}

function findVisibleElement($elements, predicate = () => true) {
  const list = [...$elements].filter((element) => {
    const $element = Cypress.$(element);
    return $element.is(":visible") && !$element.is(":disabled") && predicate(element);
  });
  return Cypress.$(list[0]);
}

function visitLsm(pathOrUrl, options = {}) {
  return cy.visit(pathOrUrl, {
    failOnStatusCode: false,
    timeout: PAGE_LOAD_TIMEOUT,
    ...options,
  });
}

function assertSuccessfulLoginResponse(response) {
  if (response.status >= 200 && response.status < 300 && response.body?.isSuccess && response.body?.data) {
    return response.body.data;
  }

  throw new Error(
    [
      "LSM Super Admin login failed before creating the Cypress session.",
      `POST /api/v1/Auth/login returned HTTP ${response.status}.`,
      `Response body: ${JSON.stringify(response.body || {})}.`,
      "Verify LSM_USERNAME/LSM_PASSWORD or update cypress/fixtures/lsm-test-data.json with valid live credentials.",
    ].join(" "),
  );
}

function loginWithCredentials(credentials) {
  cy.request({
    method: "POST",
    url: "/api/v1/Auth/login",
    failOnStatusCode: false,
    body: {
      email: credentials.username,
      password: credentials.password,
    },
  }).then((response) => {
    const token = assertSuccessfulLoginResponse(response);
    visitLsm("/dashboard", {
      onBeforeLoad(win) {
        win.localStorage.setItem("auth_token", token);
      },
    });
  });

  cy.location("pathname", { timeout: 90000 }).should((pathname) => {
    expect(pathname.toLowerCase(), "authenticated route after API login").not.to.eq(LOGIN_PATH.toLowerCase());
  });
  cy.window({ log: false }).then((win) => {
    expect(win.localStorage.getItem("auth_token"), "auth token in localStorage").to.be.a("string").and.not.be.empty;
  });
  cy.get("body", { timeout: 60000 }).should(($body) => {
    const text = normalizeText($body.text());
    expect(text.length, "authenticated page text length").to.be.greaterThan(10);
  });
}

Cypress.Commands.add("loginAsSuperAdmin", (overrides = {}) => {
  getLoginCredentials(overrides).then((credentials) => {
    cy.session(
      ["lsm-superadmin", credentials.username],
      () => {
        loginWithCredentials(credentials);
      },
      {
        cacheAcrossSpecs: true,
        validate() {
          visitLsm("/dashboard");
          cy.location("pathname", { timeout: 60000 }).should((pathname) => {
            expect(pathname.toLowerCase()).not.to.eq(LOGIN_PATH.toLowerCase());
          });
          cy.window({ log: false }).then((win) => {
            expect(win.localStorage.getItem("auth_token"), "cached auth token").to.be.a("string").and.not.be.empty;
          });
        },
      },
    );
    visitLsm("/dashboard");
  });
});

Cypress.Commands.add("logout", () => {
  cy.get("body").then(($body) => {
    const candidate = findVisibleElement($body.find("button,a,[role='button']"), (element) => {
      const text = normalizeText(element.innerText || element.getAttribute("aria-label") || element.getAttribute("title"));
      return /logout|log out|sign out|تسجيل الخروج|خروج/i.test(text);
    });
    if (candidate.length) {
      cy.wrap(candidate).click({ force: true });
    } else {
      cy.clearCookies();
      cy.clearLocalStorage();
      visitLsm(LOGIN_PATH);
    }
  });
});

Cypress.Commands.add("navigateToModule", (moduleName) => {
  const target = normalizeText(moduleName).toLowerCase();
  cy.get("body").then(($body) => {
    const candidate = findVisibleElement($body.find("a,button,[role='button'],[role='menuitem']"), (element) => {
      const text = normalizeText(element.innerText || element.getAttribute("aria-label") || element.getAttribute("title")).toLowerCase();
      return text.includes(target);
    });
    expect(candidate.length, `module navigation ${moduleName}`).to.be.greaterThan(0);
    cy.wrap(candidate).click({ force: true });
  });
});

function collectStructure(win) {
  const doc = win.document;
  const baseOrigin = win.location.origin;
  const pageUrl = win.location.href;

  const isVisible = (element) => {
    if (!element || element.nodeType !== 1) return false;
    const style = win.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0 &&
      element.getAttribute("aria-hidden") !== "true"
    );
  };

  const textOf = (element) =>
    normalizeText(
      element.innerText ||
        element.textContent ||
        element.value ||
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.getAttribute("placeholder") ||
        "",
    );

  const selectorOf = (element) => {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const attr =
      element.getAttribute("data-testid") ||
      element.getAttribute("data-cy") ||
      element.getAttribute("formcontrolname") ||
      element.getAttribute("name") ||
      element.getAttribute("aria-label");
    if (attr) {
      return `${element.tagName.toLowerCase()}[${element.getAttribute("data-testid") ? "data-testid" : element.getAttribute("data-cy") ? "data-cy" : element.getAttribute("formcontrolname") ? "formcontrolname" : element.getAttribute("name") ? "name" : "aria-label"}="${CSS.escape(attr)}"]`;
    }
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== doc.body && parts.length < 4) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) break;
      const sameTag = [...parent.children].filter((child) => child.tagName === current.tagName);
      const index = sameTag.indexOf(current) + 1;
      parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
      current = parent;
    }
    return parts.length ? parts.join(" > ") : element.tagName.toLowerCase();
  };

  const visible = (selector) => [...doc.querySelectorAll(selector)].filter(isVisible);
  const unique = (items, keyFn) => {
    const seen = new Set();
    return items.filter((item) => {
      const key = keyFn(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const resolveUrl = (value) => {
    if (!value) return "";
    try {
      return new URL(value, pageUrl).href;
    } catch {
      return "";
    }
  };

  const isInternalUrl = (value) => {
    try {
      const parsed = new URL(value, pageUrl);
      return parsed.origin === baseOrigin;
    } catch {
      return false;
    }
  };

  const labelFor = (field) => {
    const id = field.id;
    const explicit = id ? doc.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const parentLabel = field.closest("label");
    const ariaLabelledBy = field.getAttribute("aria-labelledby");
    const ariaElement = ariaLabelledBy ? doc.getElementById(ariaLabelledBy) : null;
    const nearby = field.closest(".form-group,.mb-3,.field,.mat-mdc-form-field,.p-field,.ant-form-item,[class*='form']");
    const nearbyLabel = nearby ? nearby.querySelector("label,.mat-mdc-floating-label,.p-float-label,label span") : null;
    return normalizeText(
      field.getAttribute("aria-label") ||
        explicit?.innerText ||
        parentLabel?.innerText ||
        ariaElement?.innerText ||
        nearbyLabel?.innerText ||
        field.getAttribute("placeholder") ||
        field.getAttribute("name") ||
        field.getAttribute("formcontrolname") ||
        field.id ||
        "",
    );
  };

  const optionValues = (select) =>
    [...select.querySelectorAll("option")]
      .map((option) => normalizeText(option.innerText || option.value))
      .filter(Boolean)
      .slice(0, 100);

  const describeField = (field) => ({
    tagName: field.tagName.toLowerCase(),
    type: (field.getAttribute("type") || field.tagName).toLowerCase(),
    inputType: (field.getAttribute("type") || "").toLowerCase(),
    label: labelFor(field),
    placeholder: field.getAttribute("placeholder") || "",
    name: field.getAttribute("name") || field.getAttribute("formcontrolname") || "",
    id: field.id || "",
    selector: selectorOf(field),
    required: field.required || field.getAttribute("aria-required") === "true" || field.hasAttribute("required"),
    disabled: field.disabled || field.getAttribute("aria-disabled") === "true",
    readOnly: field.readOnly || field.hasAttribute("readonly"),
    value: field.type === "password" ? "" : field.value || field.getAttribute("value") || "",
    min: field.getAttribute("min") || "",
    max: field.getAttribute("max") || "",
    minLength: field.getAttribute("minlength") || "",
    maxLength: field.getAttribute("maxlength") || "",
    pattern: field.getAttribute("pattern") || "",
    autocomplete: field.getAttribute("autocomplete") || "",
    options: field.tagName.toLowerCase() === "select" ? optionValues(field) : [],
  });

  const anchors = visible("a[href],area[href]")
    .map((anchor) => {
      const href = resolveUrl(anchor.getAttribute("href"));
      const text = textOf(anchor);
      return {
        text,
        href,
        selector: selectorOf(anchor),
        target: anchor.getAttribute("target") || "",
        internal: isInternalUrl(href),
        isLogout: /logout|signout|تسجيل الخروج|خروج/i.test(`${text} ${href}`),
        isActionLike: /edit|view|details|create|add|delete|export|تعديل|عرض|تفاصيل|إضافة|حذف|تصدير/i.test(text),
      };
    })
    .filter((link) => link.href);

  const routerLinks = visible("[routerlink],[ng-reflect-router-link],[data-url],[data-route]")
    .map((element) => {
      const raw =
        element.getAttribute("routerlink") ||
        element.getAttribute("ng-reflect-router-link") ||
        element.getAttribute("data-url") ||
        element.getAttribute("data-route");
      const href = resolveUrl(raw);
      return {
        text: textOf(element),
        href,
        selector: selectorOf(element),
        internal: isInternalUrl(href),
        source: "routerLink",
      };
    })
    .filter((link) => link.href);

  const buttons = visible("button,input[type='button'],input[type='submit'],[role='button'],.mat-mdc-button,.mat-mdc-menu-item")
    .map((button) => ({
      text: textOf(button),
      selector: selectorOf(button),
      type: button.getAttribute("type") || button.getAttribute("role") || button.tagName.toLowerCase(),
      disabled: button.disabled || button.getAttribute("aria-disabled") === "true",
      ariaLabel: button.getAttribute("aria-label") || "",
      title: button.getAttribute("title") || "",
      hasPopup: button.getAttribute("aria-haspopup") || button.getAttribute("data-bs-toggle") || "",
      expanded: button.getAttribute("aria-expanded") || "",
      unsafe: unsafeActionPattern.test(textOf(button)),
      safeToOpen: safeOpenPattern.test(`${textOf(button)} ${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`),
    }))
    .filter((button) => button.text || button.ariaLabel || button.title || button.type);

  const inputFields = visible("input")
    .filter((input) => !["hidden", "checkbox", "radio", "file", "submit", "button", "image", "reset"].includes((input.type || "").toLowerCase()))
    .map(describeField);
  const textAreas = visible("textarea").map(describeField);
  const selectLists = visible("select,[role='combobox'],.mat-mdc-select,.ng-select,.p-dropdown,.ant-select")
    .filter((select) => select.tagName.toLowerCase() === "select" || textOf(select) || select.getAttribute("aria-label"))
    .map((select) => ({
      ...describeField(select),
      options: select.tagName.toLowerCase() === "select" ? optionValues(select) : [],
      text: textOf(select),
    }));
  const checkboxes = visible("input[type='checkbox'],[role='checkbox']").map(describeField);
  const radioButtons = visible("input[type='radio'],[role='radio']").map(describeField);
  const dateFields = inputFields.filter((field) => /date|time|تاريخ|وقت/i.test(`${field.type} ${field.label} ${field.placeholder} ${field.name}`));
  const fileUploadFields = visible("input[type='file']").map(describeField);

  const formElements = visible("form,.mat-mdc-dialog-container form,.modal form,[role='dialog'] form");
  const forms = formElements.map((form, formIndex) => {
    const fieldElements = [...form.querySelectorAll("input,textarea,select,[role='combobox'],[role='checkbox'],[role='radio']")].filter(isVisible);
    return {
      title: normalizeText(form.getAttribute("aria-label") || form.querySelector("h1,h2,h3,h4,legend,.modal-title")?.innerText || `form ${formIndex + 1}`),
      selector: selectorOf(form),
      method: form.getAttribute("method") || "",
      action: form.getAttribute("action") || "",
      fields: fieldElements.map(describeField),
      buttons: [...form.querySelectorAll("button,input[type='submit'],input[type='button']")].filter(isVisible).map((button) => textOf(button)),
    };
  });

  if (forms.length === 0 && [...inputFields, ...textAreas, ...selectLists, ...checkboxes, ...radioButtons, ...fileUploadFields].length > 0) {
    forms.push({
      title: normalizeText(doc.querySelector("h1,h2,h3,.page-title")?.innerText || "page fields"),
      selector: "synthetic-page-fields",
      method: "",
      action: "",
      fields: [...inputFields, ...textAreas, ...selectLists, ...checkboxes, ...radioButtons, ...fileUploadFields],
      buttons: buttons.map((button) => button.text).filter(Boolean),
    });
  }

  const tables = visible("table,[role='table'],.mat-mdc-table,.cdk-table,.p-datatable,.ant-table")
    .map((table, tableIndex) => {
      const headerCandidates = [
        ...table.querySelectorAll("th,[role='columnheader'],.mat-mdc-header-cell,.cdk-header-cell,.p-column-title"),
      ].filter(isVisible);
      const columns = unique(
        headerCandidates
          .map((header) => normalizeText(header.innerText || header.getAttribute("aria-label") || header.getAttribute("title")))
          .filter(Boolean),
        (column) => column,
      );
      const rows = [...table.querySelectorAll("tbody tr,[role='row'],.mat-mdc-row,.cdk-row")].filter(isVisible).length;
      return {
        caption: normalizeText(table.querySelector("caption")?.innerText || table.getAttribute("aria-label") || `table ${tableIndex + 1}`),
        selector: selectorOf(table),
        columns,
        rowCount: rows,
        sortableColumns: columns.filter((column) => {
          const match = headerCandidates.find((header) => normalizeText(header.innerText).includes(column));
          return Boolean(match && (match.getAttribute("aria-sort") || match.querySelector("button,[role='button'],.mat-sort-header-arrow")));
        }),
      };
    });

  const searchFields = inputFields.filter((field) => /search|بحث/i.test(`${field.type} ${field.label} ${field.placeholder} ${field.name}`));
  const filters = [
    ...buttons.filter((button) => /filter|تصفية/i.test(`${button.text} ${button.ariaLabel}`)),
    ...selectLists,
  ];
  const sortingControls = visible("[aria-sort],.mat-sort-header,.sortable,[data-sort]")
    .map((element) => ({
      text: textOf(element),
      selector: selectorOf(element),
      sort: element.getAttribute("aria-sort") || element.getAttribute("data-sort") || "",
    }))
    .filter((item) => item.text || item.sort);

  const pagination = visible(".pagination,[class*='paginat'],mat-paginator,.mat-mdc-paginator,[aria-label*='pagination' i]")
    .map((element) => ({
      text: textOf(element),
      selector: selectorOf(element),
    }))
    .filter((item) => item.text);

  const tabs = visible("[role='tab'],.mat-mdc-tab,.nav-tabs a,.p-tabview-nav-link")
    .map((tab) => ({
      text: textOf(tab),
      selector: selectorOf(tab),
      selected: tab.getAttribute("aria-selected") || tab.classList.contains("active"),
    }))
    .filter((tab) => tab.text);

  const cards = visible(".card,mat-card,.mat-mdc-card,.p-card,.ant-card,[class*='card']")
    .map((card) => ({
      title: normalizeText(card.querySelector("h1,h2,h3,h4,h5,h6,.card-title,.mat-mdc-card-title")?.innerText || ""),
      text: textOf(card).slice(0, 300),
      selector: selectorOf(card),
      links: [...card.querySelectorAll("a[href]")].filter(isVisible).map((link) => resolveUrl(link.getAttribute("href"))),
    }))
    .filter((card) => card.title || card.text)
    .slice(0, 80);

  const charts = visible("canvas,svg,.apexcharts-canvas,.chart,[class*='chart'],[id*='chart']")
    .map((chart) => ({
      title: normalizeText(chart.getAttribute("aria-label") || chart.getAttribute("title") || chart.closest("[aria-label]")?.getAttribute("aria-label") || ""),
      selector: selectorOf(chart),
      tagName: chart.tagName.toLowerCase(),
    }))
    .slice(0, 40);

  const modals = visible("[role='dialog'],.modal,.modal-dialog,.mat-mdc-dialog-container,.cdk-overlay-pane,.swal2-popup")
    .map((modal) => ({
      title: normalizeText(modal.querySelector("h1,h2,h3,h4,.modal-title,[role='heading']")?.innerText || modal.getAttribute("aria-label") || ""),
      text: textOf(modal).slice(0, 500),
      selector: selectorOf(modal),
      buttons: [...modal.querySelectorAll("button,[role='button']")].filter(isVisible).map((button) => textOf(button)),
      fields: [...modal.querySelectorAll("input,textarea,select,[role='combobox']")].filter(isVisible).map(describeField),
    }));

  const statusValues = visible(".badge,.chip,.status,[class*='status'],[class*='badge'],[class*='chip'],.mat-mdc-chip")
    .map((element) => ({
      text: textOf(element),
      selector: selectorOf(element),
      className: element.className ? String(element.className).slice(0, 200) : "",
    }))
    .filter((status) => status.text && status.text.length < 80);

  const breadcrumbs = visible(".breadcrumb a,.breadcrumb li,[aria-label*='breadcrumb' i] a,[aria-label*='breadcrumb' i] li")
    .map((element) => ({
      text: textOf(element),
      href: element.href ? resolveUrl(element.getAttribute("href")) : "",
      selector: selectorOf(element),
    }))
    .filter((item) => item.text);

  const headings = visible("h1,h2,h3,h4,h5,h6,[role='heading'],.page-title,.title")
    .map((heading) => ({
      level: heading.tagName.match(/^H[1-6]$/) ? Number(heading.tagName.slice(1)) : Number(heading.getAttribute("aria-level") || 0),
      text: textOf(heading),
      selector: selectorOf(heading),
    }))
    .filter((heading) => heading.text);

  const navItems = visible("aside a,aside button,nav a,nav button,.sidebar a,.sidebar button,[role='navigation'] a,[role='navigation'] button")
    .map((item) => ({
      text: textOf(item),
      href: item.href ? resolveUrl(item.getAttribute("href")) : resolveUrl(item.getAttribute("routerlink") || item.getAttribute("ng-reflect-router-link")),
      selector: selectorOf(item),
      active: item.classList.contains("active") || item.getAttribute("aria-current") === "page",
    }))
    .filter((item) => item.text || item.href);

  const links = unique([...anchors, ...routerLinks], (link) => `${link.href}|${link.text}`);
  const internalRoutes = unique(
    links
      .filter((link) => link.internal && !link.isLogout && link.href && !/#$/.test(link.href))
      .map((link) => ({
        url: link.href,
        text: link.text,
        source: link.source || "link",
        selector: link.selector,
      })),
    (route) => route.url,
  );

  const activeNav = navItems.find((item) => item.active);
  const headingText = headings[0]?.text || doc.title || "";
  const pathParts = win.location.pathname.split("/").filter(Boolean);

  return {
    capturedAt: new Date().toISOString(),
    title: doc.title || "",
    pageTitle: headingText,
    url: pageUrl,
    normalizedUrl: pageUrl.split("#")[0],
    routePattern: pageUrl
      .split("#")[0]
      .replace(/\/\d+(?=\/|$)/g, "/:id")
      .replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, "/:hash"),
    module: normalizeText(activeNav?.text || breadcrumbs[0]?.text || headings[0]?.text || pathParts[0] || "Application"),
    submodule: normalizeText(breadcrumbs[1]?.text || headings[1]?.text || pathParts[1] || ""),
    language: doc.documentElement.lang || "",
    direction: doc.documentElement.dir || win.getComputedStyle(doc.documentElement).direction || "",
    headings,
    breadcrumbs,
    navItems,
    sidebarItems: navItems.filter((item) => /aside|sidebar|navigation/i.test(item.selector)),
    topNavigationItems: navItems.filter((item) => /nav|navigation/i.test(item.selector)),
    buttons,
    links,
    routes: internalRoutes,
    forms,
    inputFields,
    textAreas,
    selectLists,
    checkboxes,
    radioButtons,
    dateFields,
    fileUploadFields,
    tables,
    tableColumns: unique(tables.flatMap((table) => table.columns), (column) => column),
    searchFields,
    filters,
    sortingControls,
    pagination,
    tabs,
    cards,
    charts,
    modals,
    confirmationDialogs: modals.filter((modal) => /confirm|are you sure|تأكيد|تؤكد|حذف/i.test(modal.text)),
    statusValues,
    availableActions: buttons.filter((button) => button.text || button.ariaLabel),
    dropdowns: buttons.filter((button) => button.hasPopup || /more|menu|المزيد|قائمة/i.test(`${button.text} ${button.ariaLabel}`)),
  };
}

Cypress.Commands.add("collectPageStructure", () => cy.window({ log: false }).then(collectStructure));

Cypress.Commands.add("collectVisibleActions", () =>
  cy.collectPageStructure().then((structure) => structure.availableActions || []),
);

Cypress.Commands.add("collectFormFields", () =>
  cy.collectPageStructure().then((structure) => [
    ...(structure.inputFields || []),
    ...(structure.textAreas || []),
    ...(structure.selectLists || []),
    ...(structure.checkboxes || []),
    ...(structure.radioButtons || []),
    ...(structure.dateFields || []),
    ...(structure.fileUploadFields || []),
  ]),
);

Cypress.Commands.add("collectTableStructure", () => cy.collectPageStructure().then((structure) => structure.tables || []));

Cypress.Commands.add("saveDiscoveryResult", (discovery) => cy.task("generateLsmOutputs", discovery, { timeout: 120000 }));

Cypress.Commands.add("expandVisibleNavigation", () => {
  cy.window({ log: false }).then((win) => {
    const doc = win.document;
    const candidates = [
      ...doc.querySelectorAll(
        "aside button,nav button,.sidebar button,[role='navigation'] button,.mat-expansion-panel-header,[aria-expanded='false'],[aria-haspopup='menu'],[aria-haspopup='listbox']",
      ),
    ]
      .filter((element) => {
        const text = normalizeText(element.innerText || element.getAttribute("aria-label") || element.getAttribute("title"));
        const style = win.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          !unsafeActionPattern.test(text) &&
          (element.getAttribute("aria-expanded") === "false" || safeOpenPattern.test(text) || element.getAttribute("aria-haspopup"))
        );
      })
      .slice(0, 40);

    for (const candidate of candidates) {
      try {
        candidate.click();
      } catch {
        // Best-effort expansion only; the test continues with visible links.
      }
    }
  });
});
