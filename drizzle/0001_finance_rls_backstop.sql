-- Row-level security as a *backstop only*.
--
-- App-layer RBAC is the real access control for TavrenOPS; this exists so that
-- a forgotten WHERE clause or a future careless join cannot leak the two
-- things that genuinely hurt when they leak internally:
--   * project_financials  - contract value, margin
--   * user_rates          - what each person is paid
--
-- FORCE is deliberate: without it the table owner (the role migrations and the
-- app both connect as) bypasses every policy, which would make this decorative.
-- With FORCE, these tables return zero rows unless the caller has explicitly
-- opted in for the current transaction via withFinanceAccess().

ALTER TABLE "project_financials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_financials" FORCE ROW LEVEL SECURITY;

ALTER TABLE "user_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_rates" FORCE ROW LEVEL SECURITY;

-- current_setting(..., true) returns NULL rather than erroring when the GUC was
-- never set, so the default posture for any un-opted-in query is deny.
CREATE POLICY "financials_requires_optin" ON "project_financials"
  FOR ALL
  USING (current_setting('tavren.finance_access', true) = 'on')
  WITH CHECK (current_setting('tavren.finance_access', true) = 'on');

CREATE POLICY "rates_requires_optin" ON "user_rates"
  FOR ALL
  USING (current_setting('tavren.finance_access', true) = 'on')
  WITH CHECK (current_setting('tavren.finance_access', true) = 'on');
