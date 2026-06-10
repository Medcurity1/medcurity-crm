const architecturePillars = [
  "Supabase as the system of record",
  "Soft delete and restore by default",
  "Audit logs on every core write",
  "Role-aware access with RLS",
  "Fixed SQL-backed reporting first",
];

const mvpScope = [
  "Accounts, contacts, and opportunities",
  "Sales pipeline with stage history",
  "Renewals handoff and queue",
  "Archive and restore workflows",
  "3 to 5 trusted reports",
];

const laterScope = [
  "Email and calendar sync",
  "Generic report builder",
  "Forecasting",
  "Marketing automation",
  "Expanded dashboarding",
];

export function DashboardOverview() {
  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Pulse MVP</span>
          <h1>Backend-first CRM foundation for sales and renewals.</h1>
          <p>
            This starter is intentionally opinionated: reliable data model first,
            minimal workflow surface second, and reporting only where the numbers
            can be trusted.
          </p>
        </div>

        <div className="hero-grid">
          <article className="metric-card">
            <h3>MVP checkpoint</h3>
            <p>Decision deadline</p>
            <strong>April 14</strong>
          </article>

          <article className="metric-card">
            <h3>Target build window</h3>
            <p>First complete internal version</p>
            <strong>May 5</strong>
          </article>

          <article className="metric-card">
            <h3>Primary risk</h3>
            <p>Reporting complexity if the schema drifts early.</p>
            <strong>Guardrails on</strong>
          </article>
        </div>
      </section>

      <section className="sections-grid">
        <article className="section-card">
          <h2>Architecture pillars</h2>
          <div className="pill-row">
            {architecturePillars.map((pillar) => (
              <span className="pill" key={pillar}>
                {pillar}
              </span>
            ))}
          </div>
        </article>

        <article className="section-card">
          <h2>MVP scope</h2>
          <ul className="list">
            {mvpScope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="section-card">
          <h2>Explicitly delayed</h2>
          <ul className="list">
            {laterScope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="section-card">
          <h2>What to do next</h2>
          <ul className="list">
            <li>Create the Supabase project and copy credentials into `.env`.</li>
            <li>Run the initial schema in Supabase SQL Editor.</li>
            <li>Invite 2 to 3 internal pilot users and assign roles.</li>
            <li>Load a small real dataset before UI work expands.</li>
          </ul>
        </article>
      </section>

      <div className="callout">
        Reporting should be built from stable SQL views and RPCs first. A custom
        report builder is a second-phase feature, not an MVP dependency.
      </div>
    </main>
  );
}
