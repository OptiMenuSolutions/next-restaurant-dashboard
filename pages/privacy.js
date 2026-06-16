import Head from 'next/head';
import Link from 'next/link';

// OptiMenu — Privacy Policy
// Starter draft. Replace every [BRACKETED] placeholder with your real values
// and have an attorney review before publishing.

const EFFECTIVE_DATE = 'June 16, 2026';
const ENTITY = 'OptiMenu Solutions LLC';      // e.g. "OptiMenu LLC"
const CONTACT_EMAIL = 'privacy@opti-menu.com';   // e.g. "privacy@optimenu.app"

const SECTIONS = [
  ['scope', '1. Who this policy covers'],
  ['collect', '2. Information we collect'],
  ['use', '3. How we use information'],
  ['ai', '4. AI processing & how recommendations are generated'],
  ['share', '5. How we share information'],
  ['retention', '6. Data retention'],
  ['security', '7. Security'],
  ['rights', '8. Your rights & choices'],
  ['cookies', '9. Cookies & similar technologies'],
  ['integrations', '10. Third-party integrations & links'],
  ['children', '11. Children'],
  ['changes', '12. Changes to this policy'],
  ['contact', '13. Contact us'],
];

export default function Privacy() {
  return (
    <>
      <Head>
        <title>Privacy Policy — OptiMenu</title>
        <meta name="description" content="How OptiMenu collects, uses, and protects your information." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div className="legal-root">
        <header className="legal-bar">
          <Link href="/" className="legal-wordmark">OptiMenu</Link>
          <Link href="/" className="legal-back">← Back to home</Link>
        </header>

        <main className="legal-wrap">
          <p className="legal-eyebrow">Legal</p>
          <h1 className="legal-title">Privacy Policy</h1>
          <p className="legal-effective">Effective {EFFECTIVE_DATE}</p>

          <p className="legal-lede">
            {ENTITY} (&ldquo;OptiMenu,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;)
            provides a software platform that helps independent restaurant operators reduce food
            waste and improve margins, including our &ldquo;Tonight&rsquo;s Dish&rdquo;
            recommendation engine. This policy explains what information we collect when you use
            OptiMenu, how we use it, who we share it with, and the choices you have. By using
            OptiMenu, you agree to the practices described here.
          </p>

          <nav className="legal-toc" aria-label="Table of contents">
            <ul>
              {SECTIONS.map(([id, label]) => (
                <li key={id}><a href={`#${id}`}>{label}</a></li>
              ))}
            </ul>
          </nav>

          <section id="scope">
            <h2>1. Who this policy covers</h2>
            <p>
              OptiMenu is a business-to-business service intended for restaurant owners, managers,
              and the staff they authorize. This policy applies to the account holders and
              authorized users of a restaurant&rsquo;s OptiMenu workspace. Where a restaurant
              uploads data about its own operations, suppliers, or transactions, the restaurant is
              responsible for ensuring it has the right to share that data with us, and we process
              it on the restaurant&rsquo;s behalf.
            </p>
          </section>

          <section id="collect">
            <h2>2. Information we collect</h2>

            <h3>Information you provide directly</h3>
            <ul>
              <li>
                <strong>Account &amp; restaurant details</strong> — name, email address, restaurant
                name, location, and other profile information you enter when you create or manage an
                account.
              </li>
              <li>
                <strong>Menu &amp; recipe data</strong> — menu items, recipes, ingredients, portion
                and yield information, and pricing you add or import (including via our menu parser).
              </li>
              <li>
                <strong>Invoices &amp; supplier documents</strong> — invoice images and files you
                upload, and the line-item data extracted from them (vendor, item, quantity, unit
                cost, dates).
              </li>
              <li>
                <strong>Billing information</strong> — your subscription plan and payment status. We
                use Stripe to process payments; card numbers are handled by Stripe and are not
                stored on our servers.
              </li>
              <li>
                <strong>Support communications</strong> — messages, feedback, and other information
                you send us.
              </li>
            </ul>

            <h3>Information from connected services</h3>
            <ul>
              <li>
                <strong>Point-of-sale (POS) data</strong> — when you connect a POS provider (such as
                Shift4/SkyTab or Square), we receive sales and transaction data such as items sold,
                quantities, timestamps, and totals, used to rank popularity and estimate waste risk.
              </li>
            </ul>

            <h3>Information collected automatically</h3>
            <ul>
              <li>
                <strong>Usage &amp; device data</strong> — basic log information such as pages
                viewed, actions taken, approximate device and browser type, and timestamps, used to
                operate, secure, and improve the service.
              </li>
              <li>
                <strong>NFC / staff briefing access</strong> — when staff tap an NFC tag to view a
                shift&rsquo;s recommendations, we may log that the briefing page was accessed in
                order to operate the feature. These pages are designed to work without staff
                accounts or personal logins.
              </li>
            </ul>
          </section>

          <section id="use">
            <h2>3. How we use information</h2>
            <p>We use the information above to:</p>
            <ul>
              <li>generate Tonight&rsquo;s Dish recommendations and the underlying waste-risk, popularity, and margin signals;</li>
              <li>parse and organize your invoices, menus, and ingredient data;</li>
              <li>create, authenticate, and manage your account and workspace;</li>
              <li>process subscriptions, billing, and renewals;</li>
              <li>provide customer support and respond to your requests;</li>
              <li>maintain, secure, troubleshoot, and improve the service;</li>
              <li>comply with legal obligations and enforce our terms.</li>
            </ul>
          </section>

          <section id="ai">
            <h2>4. AI processing &amp; how recommendations are generated</h2>
            <p>
              OptiMenu&rsquo;s core features rely on AI services to read documents and produce
              recommendations. Specifically, invoice images may be processed using optical character
              recognition (currently provided by Mistral), and recommendation and parsing logic uses
              the Anthropic (Claude) API. To deliver these features, relevant data — such as invoice
              contents, menu and recipe details, and aggregated sales signals — is transmitted to
              these providers solely to perform the requested processing and return results to your
              workspace.
            </p>
            <p>
              Recommendations are generated to assist your decision-making and are not a substitute
              for your own judgment regarding food safety, inventory, purchasing, or pricing. See our{' '}
              <Link href="/terms">Terms of Service</Link> for the full disclaimer on how to treat
              recommendations.
            </p>
          </section>

          <section id="share">
            <h2>5. How we share information</h2>
            <p>
              <strong>We do not sell your personal information.</strong> We share information only as
              described below:
            </p>
            <ul>
              <li>
                <strong>Service providers (subprocessors).</strong> We rely on trusted third parties
                to run OptiMenu. Each receives only the data needed to perform its function:
              </li>
            </ul>

            <div className="legal-table-wrap">
              <table className="legal-table">
                <thead>
                  <tr><th>Provider</th><th>Purpose</th></tr>
                </thead>
                <tbody>
                  <tr><td>Supabase</td><td>Database, authentication &amp; file storage</td></tr>
                  <tr><td>Vercel</td><td>Application hosting &amp; delivery</td></tr>
                  <tr><td>Stripe</td><td>Subscription billing &amp; payment processing</td></tr>
                  <tr><td>Anthropic (Claude)</td><td>Recommendation &amp; parsing engine</td></tr>
                  <tr><td>Mistral</td><td>Invoice OCR / text extraction</td></tr>
                  <tr><td>POS providers (e.g. Shift4/SkyTab, Square)</td><td>Sales data integration (when you connect them)</td></tr>
                </tbody>
              </table>
            </div>

            <ul>
              <li>
                <strong>Legal &amp; safety.</strong> We may disclose information if required by law,
                or to protect the rights, property, or safety of OptiMenu, our users, or others.
              </li>
              <li>
                <strong>Business transfers.</strong> If OptiMenu is involved in a merger,
                acquisition, or sale of assets, information may be transferred as part of that
                transaction, subject to this policy.
              </li>
            </ul>
          </section>

          <section id="retention">
            <h2>6. Data retention</h2>
            <p>
              We retain your information for as long as your account is active and as needed to
              provide the service. After you close your account, we delete or de-identify your data
              within a reasonable period, except where we must retain certain records to comply with
              legal, tax, accounting, or security obligations, or to resolve disputes. You can
              request deletion as described below.
            </p>
          </section>

          <section id="security">
            <h2>7. Security</h2>
            <p>
              We take reasonable measures to protect your information, including encryption of data
              in transit, row-level security and access controls on our database, and ownership
              checks that restrict each workspace&rsquo;s data to authorized users. No method of
              transmission or storage is completely secure, so we cannot guarantee absolute security,
              but we work to protect your information and to address vulnerabilities promptly.
            </p>
          </section>

          <section id="rights">
            <h2>8. Your rights &amp; choices</h2>
            <p>
              Depending on your location, you may have rights to access, correct, export, or delete
              your information, or to object to or restrict certain processing. To make a request, or
              to close your account and have associated data deleted, contact us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We will respond consistent with
              applicable law. You can also manage or cancel your subscription from your account
              settings.
            </p>
          </section>

          <section id="cookies">
            <h2>9. Cookies &amp; similar technologies</h2>
            <p>
              We use cookies and similar technologies that are necessary to keep you signed in,
              remember preferences, secure the service, and understand basic usage. You can control
              cookies through your browser settings; disabling certain cookies may affect how the
              service works.
            </p>
          </section>

          <section id="integrations">
            <h2>10. Third-party integrations &amp; links</h2>
            <p>
              When you connect a third-party service (such as a POS provider) or follow a link to a
              third-party site, that third party&rsquo;s own privacy practices apply to the
              information it collects. We are not responsible for the privacy practices of services
              we do not control. Review their policies before connecting or sharing data.
            </p>
          </section>

          <section id="children">
            <h2>11. Children</h2>
            <p>
              OptiMenu is intended for businesses and is not directed to children under 16. We do not
              knowingly collect personal information from children. If you believe a child has
              provided us information, contact us and we will take appropriate steps to delete it.
            </p>
          </section>

          <section id="changes">
            <h2>12. Changes to this policy</h2>
            <p>
              We may update this policy from time to time. When we do, we will revise the effective
              date above and, for material changes, provide additional notice where appropriate. Your
              continued use of OptiMenu after an update means you accept the revised policy.
            </p>
          </section>

          <section id="contact">
            <h2>13. Contact us</h2>
            <p>
              Questions about this policy or your data? Reach us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          </section>

          <footer className="legal-footer">
            <span>&copy; {new Date().getFullYear()} {ENTITY}. All rights reserved.</span>
            <span className="legal-footer-links">
              <Link href="/terms">Terms of Service</Link>
              <Link href="/">Home</Link>
            </span>
          </footer>
        </main>
      </div>

      <style jsx>{`
        .legal-root {
          --bg-root: #14110f;
          --bg-surface: #1d1a17;
          --ink: #ece6dd;
          --ink-soft: #b4aaa0;
          --accent: #02a4ba;
          --line: #34302b;
          min-height: 100vh;
          background:
            radial-gradient(1100px 520px at 78% -8%, rgba(2,164,186,0.10), transparent 60%),
            var(--bg-root);
          color: var(--ink);
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .legal-bar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 18px clamp(20px, 5vw, 56px);
          border-bottom: 1px solid var(--line);
          position: sticky; top: 0;
          background: rgba(20,17,15,0.82);
          backdrop-filter: blur(8px);
          z-index: 10;
        }
        .legal-wordmark {
          font-family: 'Playfair Display', serif;
          font-weight: 700; font-size: 1.25rem; letter-spacing: .2px;
          color: var(--ink); text-decoration: none;
        }
        .legal-wordmark::after { content: '.'; color: var(--accent); }
        .legal-back { color: var(--ink-soft); text-decoration: none; font-size: .9rem; }
        .legal-back:hover { color: var(--accent); }

        .legal-wrap {
          max-width: 760px;
          margin: 0 auto;
          padding: clamp(40px, 6vw, 72px) clamp(20px, 5vw, 40px) 80px;
        }
        .legal-eyebrow {
          text-transform: uppercase; letter-spacing: .22em; font-size: .72rem;
          color: var(--accent); font-weight: 600; margin: 0 0 10px;
        }
        .legal-title {
          font-family: 'Playfair Display', serif;
          font-weight: 700; font-size: clamp(2.1rem, 5vw, 3rem);
          margin: 0 0 8px; line-height: 1.05;
        }
        .legal-effective { color: var(--ink-soft); font-size: .92rem; margin: 0 0 30px; }
        .legal-lede {
          font-size: 1.04rem; line-height: 1.72; color: var(--ink);
          padding-bottom: 28px; border-bottom: 1px solid var(--line); margin-bottom: 8px;
        }

        .legal-toc {
          background: var(--bg-surface);
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 20px 24px;
          margin: 28px 0 8px;
        }
        .legal-toc ul { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 28px; }
        .legal-toc li { margin: 0 0 9px; break-inside: avoid; }
        .legal-toc a { color: var(--ink-soft); text-decoration: none; font-size: .9rem; }
        .legal-toc a:hover { color: var(--accent); }

        section { margin-top: 40px; scroll-margin-top: 84px; }
        h2 {
          font-family: 'Playfair Display', serif;
          font-weight: 600; font-size: 1.5rem; margin: 0 0 14px;
          padding-top: 6px;
        }
        h3 {
          font-size: 1rem; font-weight: 600; color: var(--ink);
          margin: 22px 0 8px; letter-spacing: .2px;
        }
        p { line-height: 1.72; color: var(--ink); margin: 0 0 14px; }
        ul { margin: 0 0 14px; padding-left: 22px; }
        li { line-height: 1.7; color: var(--ink); margin: 0 0 9px; }
        strong { color: #fff; font-weight: 600; }
        a { color: var(--accent); text-decoration: none; }
        a:hover { text-decoration: underline; }

        .legal-table-wrap { overflow-x: auto; margin: 6px 0 16px; }
        .legal-table {
          width: 100%; border-collapse: collapse; font-size: .92rem;
          border: 1px solid var(--line); border-radius: 10px; overflow: hidden;
        }
        .legal-table th, .legal-table td {
          text-align: left; padding: 11px 14px; border-bottom: 1px solid var(--line);
        }
        .legal-table th {
          background: var(--bg-surface); color: var(--ink-soft);
          font-weight: 600; font-size: .8rem; text-transform: uppercase; letter-spacing: .06em;
        }
        .legal-table tr:last-child td { border-bottom: none; }
        .legal-table td:first-child { color: #fff; font-weight: 500; white-space: nowrap; }

        .legal-footer {
          margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--line);
          display: flex; flex-wrap: wrap; gap: 14px; justify-content: space-between;
          color: var(--ink-soft); font-size: .85rem;
        }
        .legal-footer-links { display: flex; gap: 18px; }
        .legal-footer-links a { color: var(--ink-soft); }
        .legal-footer-links a:hover { color: var(--accent); }

        @media (max-width: 560px) {
          .legal-toc ul { columns: 1; }
        }
      `}</style>
    </>
  );
}