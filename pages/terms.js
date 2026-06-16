import Head from 'next/head';
import Link from 'next/link';

// OptiMenu — Terms of Service
// Starter draft. Replace every [BRACKETED] placeholder with your real values
// and have an attorney review before publishing.

const EFFECTIVE_DATE = 'June 16, 2026';
const ENTITY = 'OptiMenu Solutions LLC';        // e.g. "OptiMenu LLC"
const CONTACT_EMAIL = 'support@opti-menu.com';     // e.g. "support@optimenu.app"
const GOVERNING_STATE = 'New Jersey';
const VENUE_COUNTY = 'Union County, New Jersey';
const FOUNDING_PRICE = '59';
const STANDARD_PRICE = '79';

const SECTIONS = [
  ['accept', '1. Agreement to these terms'],
  ['service', '2. The service'],
  ['accounts', '3. Eligibility & accounts'],
  ['billing', '4. Subscriptions, pricing & billing'],
  ['data', '5. Your data & content'],
  ['third-party', '6. Third-party integrations'],
  ['ai', '7. AI recommendations — important disclaimer'],
  ['acceptable', '8. Acceptable use'],
  ['ip', '9. Intellectual property'],
  ['warranty', '10. Disclaimers'],
  ['liability', '11. Limitation of liability'],
  ['indemnity', '12. Indemnification'],
  ['termination', '13. Termination'],
  ['changes', '14. Changes to the service & terms'],
  ['law', '15. Governing law & disputes'],
  ['contact', '16. Contact'],
];

export default function Terms() {
  return (
    <>
      <Head>
        <title>Terms of Service — OptiMenu</title>
        <meta name="description" content="The terms that govern your use of OptiMenu." />
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
          <h1 className="legal-title">Terms of Service</h1>
          <p className="legal-effective">Effective {EFFECTIVE_DATE}</p>

          <p className="legal-lede">
            These Terms of Service (&ldquo;Terms&rdquo;) are a binding agreement between you and{' '}
            {ENTITY} (&ldquo;OptiMenu,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
            &ldquo;our&rdquo;) governing your access to and use of the OptiMenu platform and related
            services. Please read them carefully. By creating an account or using OptiMenu, you agree
            to these Terms and to our{' '}
            <Link href="/privacy">Privacy Policy</Link>. If you do not agree, do not use the service.
          </p>

          <nav className="legal-toc" aria-label="Table of contents">
            <ul>
              {SECTIONS.map(([id, label]) => (
                <li key={id}><a href={`#${id}`}>{label}</a></li>
              ))}
            </ul>
          </nav>

          <section id="accept">
            <h2>1. Agreement to these terms</h2>
            <p>
              By accessing or using OptiMenu, you confirm that you can form a binding contract with
              us, that you are authorized to act on behalf of the restaurant or business you
              register, and that you accept these Terms on its behalf. If you are using OptiMenu as
              an authorized member of a restaurant&rsquo;s account, the account holder&rsquo;s
              acceptance of these Terms also applies to you.
            </p>
          </section>

          <section id="service">
            <h2>2. The service</h2>
            <p>
              OptiMenu is a software platform that helps independent restaurants reduce food waste
              and improve margins. Its central feature is the &ldquo;Tonight&rsquo;s Dish&rdquo;
              recommendation engine, which suggests dishes to promote based on signals including
              waste risk, item popularity, and margin. Supporting features — invoice parsing,
              menu and ingredient management, analytics, and staff briefing tools — exist to feed
              and surface those recommendations. We may add, change, or remove features over time.
            </p>
          </section>

          <section id="accounts">
            <h2>3. Eligibility &amp; accounts</h2>
            <ul>
              <li>You must be at least 18 years old and able to enter into contracts to use OptiMenu.</li>
              <li>You are responsible for the accuracy of the information you provide and for keeping your login credentials secure.</li>
              <li>You are responsible for all activity under your account, including actions by staff or others you authorize.</li>
              <li>Notify us promptly at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> if you suspect unauthorized use of your account.</li>
            </ul>
          </section>

          <section id="billing">
            <h2>4. Subscriptions, pricing &amp; billing</h2>
            <ul>
              <li>
                <strong>Subscription.</strong> OptiMenu is offered on a recurring subscription basis.
                By subscribing, you authorize us and our payment processor to charge your payment
                method on a recurring basis until you cancel.
              </li>
              <li>
                <strong>Pricing.</strong> Standard pricing is ${STANDARD_PRICE} per month. Eligible
                early customers may subscribe at a founding rate of ${FOUNDING_PRICE} per month.
                Where offered, the founding rate applies as described at the time of sign-up; we will
                not change it for an active founding subscriber except as permitted in these Terms or
                as you otherwise agree.
              </li>
              <li>
                <strong>Payment processing.</strong> Payments are processed by Stripe. You agree to
                Stripe&rsquo;s applicable terms, and you are responsible for providing accurate,
                current billing information.
              </li>
              <li>
                <strong>Renewal.</strong> Subscriptions renew automatically for successive periods at
                the then-current rate for your plan unless you cancel before the renewal date.
              </li>
              <li>
                <strong>Cancellation.</strong> You may cancel at any time from your account settings.
                Cancellation stops future renewals; it takes effect at the end of your current
                billing period, and you retain access until then.
              </li>
              <li>
                <strong>Refunds.</strong> Except where required by law, payments are non-refundable
                and we do not provide refunds or credits for partial periods. {/* adjust if you adopt a refund policy */}
              </li>
              <li>
                <strong>Price changes.</strong> We may change standard pricing on a going-forward
                basis. We will give reasonable advance notice of any change that would affect your
                renewals.
              </li>
              <li>
                <strong>Taxes.</strong> Stated prices do not include taxes. You are responsible for
                any applicable sales, use, or similar taxes.
              </li>
            </ul>
          </section>

          <section id="data">
            <h2>5. Your data &amp; content</h2>
            <p>
              <strong>You own your data.</strong> As between you and OptiMenu, you retain all rights
              to the data and content you provide or connect — including menus, recipes, invoices,
              and sales data (&ldquo;Your Data&rdquo;). You grant us a non-exclusive, worldwide
              license to host, process, transmit, and display Your Data as needed to operate and
              provide the service to you, including transmitting relevant data to the subprocessors
              described in our <Link href="/privacy">Privacy Policy</Link>.
            </p>
            <p>
              You represent that you have the rights necessary to provide Your Data to us and that
              doing so does not violate any law or third-party rights. We may use aggregated,
              de-identified data that does not identify you or your restaurant to operate, analyze,
              and improve the service.
            </p>
          </section>

          <section id="third-party">
            <h2>6. Third-party integrations</h2>
            <p>
              OptiMenu connects with third-party services, such as POS providers (for example,
              Shift4/SkyTab or Square) and payment processing. Those services are operated by third
              parties under their own terms and privacy policies, and their availability and accuracy
              are outside our control. We are not responsible for third-party services, and your use
              of them is at your own risk. If a third-party service changes or becomes unavailable,
              related OptiMenu features may be affected.
            </p>
          </section>

          <section id="ai">
            <h2>7. AI recommendations — important disclaimer</h2>
            <div className="legal-callout">
              <p>
                <strong>OptiMenu&rsquo;s recommendations are advisory only.</strong> Tonight&rsquo;s
                Dish suggestions, waste-risk estimates, margin figures, and other outputs are
                generated using automated and AI-based methods from the data available to us. They
                may be incomplete, inaccurate, or unsuitable for your circumstances.
              </p>
              <p>
                You are solely responsible for all decisions you make in running your restaurant,
                including decisions about <strong>food safety, spoilage, allergens, inventory,
                purchasing, staffing, and pricing.</strong> OptiMenu does not provide food-safety,
                culinary, legal, financial, or professional advice, and our outputs are not a
                substitute for your own judgment, professional advice, or applicable health and
                safety requirements. Always independently verify the condition and safety of any
                ingredient before use. We do not guarantee any particular result, level of accuracy,
                cost savings, or revenue from using OptiMenu.
              </p>
            </div>
          </section>

          <section id="acceptable">
            <h2>8. Acceptable use</h2>
            <p>You agree not to:</p>
            <ul>
              <li>use OptiMenu for any unlawful purpose or in violation of these Terms;</li>
              <li>upload data you do not have the right to share, or that infringes others&rsquo; rights;</li>
              <li>attempt to access accounts, data, or systems that are not yours;</li>
              <li>reverse engineer, scrape, overload, or interfere with the service or its security;</li>
              <li>resell, sublicense, or provide the service to third parties except as expressly permitted; or</li>
              <li>misuse AI features, including attempts to extract underlying models or generate harmful content.</li>
            </ul>
          </section>

          <section id="ip">
            <h2>9. Intellectual property</h2>
            <p>
              OptiMenu, including its software, design, branding, and content (excluding Your Data),
              is owned by {ENTITY} and protected by intellectual property laws. We grant you a
              limited, non-exclusive, non-transferable, revocable right to use the service during
              your subscription, solely for your restaurant&rsquo;s internal business purposes. All
              rights not expressly granted are reserved. If you send us feedback or suggestions, you
              grant us the right to use them without obligation to you.
            </p>
          </section>

          <section id="warranty">
            <h2>10. Disclaimers</h2>
            <p>
              The service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without
              warranties of any kind, whether express, implied, or statutory, including implied
              warranties of merchantability, fitness for a particular purpose, title, and
              non-infringement. We do not warrant that the service will be uninterrupted, error-free,
              secure, or that outputs will be accurate or reliable. Some jurisdictions do not allow
              certain warranty exclusions, so some of the above may not apply to you.
            </p>
          </section>

          <section id="liability">
            <h2>11. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, {ENTITY} and its owners and affiliates will not
              be liable for any indirect, incidental, special, consequential, exemplary, or punitive
              damages, or for lost profits, revenue, data, or goodwill, or for food spoilage,
              waste, or business interruption, arising out of or relating to your use of (or
              inability to use) OptiMenu, even if advised of the possibility of such damages.
            </p>
            <p>
              To the maximum extent permitted by law, our total aggregate liability for any claim
              relating to the service will not exceed the amounts you paid to us for the service in
              the three (3) months immediately before the event giving rise to the claim. Some
              jurisdictions do not allow certain limitations, so some of the above may not apply to
              you.
            </p>
          </section>

          <section id="indemnity">
            <h2>12. Indemnification</h2>
            <p>
              You agree to indemnify and hold harmless {ENTITY} and its owners and affiliates from
              and against any claims, damages, losses, liabilities, and reasonable expenses
              (including legal fees) arising out of or related to your use of the service, Your Data,
              your violation of these Terms, or your violation of any law or third-party right.
            </p>
          </section>

          <section id="termination">
            <h2>13. Termination</h2>
            <p>
              You may stop using OptiMenu and cancel your subscription at any time. We may suspend or
              terminate your access if you breach these Terms, if required for security or legal
              reasons, or if we discontinue the service. Upon termination, your right to use the
              service ends. Sections that by their nature should survive — including data ownership,
              disclaimers, limitation of liability, indemnification, and governing law — survive
              termination. We will handle your data after termination as described in our{' '}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </section>

          <section id="changes">
            <h2>14. Changes to the service &amp; terms</h2>
            <p>
              We may modify the service and may update these Terms from time to time. When we make
              material changes, we will revise the effective date above and provide notice where
              appropriate. Your continued use of OptiMenu after changes take effect means you accept
              the updated Terms. If you do not agree, stop using the service and cancel your
              subscription.
            </p>
          </section>

          <section id="law">
            <h2>15. Governing law &amp; disputes</h2>
            <p>
              These Terms are governed by the laws of the State of {GOVERNING_STATE}, without regard
              to its conflict-of-laws rules. You agree that the state and federal courts located in
              {' '}{VENUE_COUNTY} will have exclusive jurisdiction over any dispute arising out of or
              relating to these Terms or the service, and you consent to personal jurisdiction there,
              except where applicable law provides otherwise.
            </p>
          </section>

          <section id="contact">
            <h2>16. Contact</h2>
            <p>
              Questions about these Terms? Reach us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
          </section>

          <footer className="legal-footer">
            <span>&copy; {new Date().getFullYear()} {ENTITY}. All rights reserved.</span>
            <span className="legal-footer-links">
              <Link href="/privacy">Privacy Policy</Link>
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

        .legal-callout {
          background: linear-gradient(180deg, rgba(2,164,186,0.08), rgba(2,164,186,0.03));
          border: 1px solid rgba(2,164,186,0.32);
          border-left: 3px solid var(--accent);
          border-radius: 12px;
          padding: 18px 22px 6px;
          margin: 4px 0 8px;
        }

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