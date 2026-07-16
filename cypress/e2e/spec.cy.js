describe('LSM Cypress project smoke check', () => {
  it('loads the LSM login page', () => {
    cy.visit('/login', {
      failOnStatusCode: false,
      timeout: Number(Cypress.env('LSM_PAGE_LOAD_TIMEOUT') || 180000),
    })
    cy.get('body').should('be.visible')
  })
})
