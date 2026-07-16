# LSM Cypress Application Discovery

This Cypress project logs in to the live LSM web application as Super Admin, safely discovers authenticated UI functionality, and generates detailed CSV test cases using the required template columns.

## Target

- Login URL: `https://lsm.nexumind.com/login`
- Default user: `superadmin@nm-lsm.local`
- Credentials can be overridden with `LSM_USERNAME` and `LSM_PASSWORD` environment variables.

## Commands

```bash
npm install
npm run cy:discovery
npm run validate:results
```

For visual debugging:

```bash
npm run cy:discovery:headed
```

The npm scripts clear `ELECTRON_RUN_AS_NODE` before launching Cypress. This machine had that variable set globally, and Electron-based Cypress binaries will not start correctly while it is present.

`cy.loginAsSuperAdmin()` creates its cached session through `POST /api/v1/Auth/login` and seeds the returned `auth_token` before opening `/dashboard`. If the supplied credentials are rejected, the command fails immediately with the API status/code instead of waiting for `/login` to redirect.

Optional limits:

```bash
$env:LSM_MAX_ROUTES=200; $env:LSM_MAX_SAFE_CLICKS_PER_PAGE=35; npm run cy:discovery
```

If the live page is slow to fire the browser `load` event, increase the visit timeout:

```bash
$env:LSM_PAGE_LOAD_TIMEOUT=240000; npm run cy:discovery
```

## Generated Files

The discovery run writes:

- `cypress/results/LSM_All_Test_Cases.csv`
- `cypress/results/LSM_Automated_Test_Cases.csv`
- `cypress/results/LSM_Manual_Test_Cases.csv`
- `cypress/results/lsm-discovered-application.json`
- `cypress/results/lsm-discovered-routes.csv`
- `cypress/results/lsm-discovery-report.html`

The CSV writer uses UTF-8, quotes multiline fields safely, preserves Arabic text, and validates the exact required column order.

## Safety Rules

Discovery expands menus, opens safe tabs/dropdowns/modals, and may open create/edit/view screens for inspection. It skips destructive or irreversible actions such as delete, approve, reject, deactivate, save, submit, send, logout, and bulk operations. Generated CRUD/workflow cases require timestamped Cypress test data and cleanup before any state-changing action is automated.

## Cypress Commands

Reusable commands are defined in `cypress/support/commands.js`:

- `cy.loginAsSuperAdmin()`
- `cy.logout()`
- `cy.navigateToModule(moduleName)`
- `cy.collectPageStructure()`
- `cy.collectVisibleActions()`
- `cy.collectFormFields()`
- `cy.collectTableStructure()`
- `cy.saveDiscoveryResult(discovery)`

The main discovery spec is:

`cypress/e2e/discovery/lsm-application-discovery.cy.js`
