// pages/privacy.js
// OptiMenu privacy policy. Copy is authoritative — layout comes from
// components/landing/LegalPage.
import LegalPage, {
  S, Bullets, SpecTable, MailButton,
} from '../components/landing/LegalPage';
import Link from 'next/link';

const EFFECTIVE = 'June 16, 2026';

const SUBPROCESSORS = [
  ['Supabase', 'Database, authentication & file storage'],
  ['Vercel', 'Application hosting & delivery'],
  ['Stripe', 'Subscription billing & payment processing'],
  ['Anthropic (Claude)', 'Recommendation & parsing engine'],
  ['Mistral', 'Invoice OCR / text extraction'],
  ['POS providers (e.g. Shift4/SkyTab, Square)', 'Sales data integration (when you connect them)'],
];

const SECTIONS = [
  {
    id: 'scope',
    heading: 'Who this policy covers',
    body: (
      <p style={S.p}>
        OptiMenu is a business-to-business service intended for restaurant owners, managers,
        and the staff they authorize. This policy applies to the account holders and authorized
        users of a restaurant’s OptiMenu workspace. Where a restaurant uploads data about its
        own operations, suppliers, or transactions, the restaurant is responsible for ensuring
        it has the right to share that data with us, and we process it on the restaurant’s behalf.
      </p>
    ),
  },
  {
    id: 'collect',
    heading: 'Information we collect',
    headingGap: 20,
    body: (
      <>
        <div style={S.subLabel}>Information you provide directly</div>
        <div style={{ ...S.stackTight, marginBottom: 28 }}>
          <p style={S.pTight}>
            <strong style={S.strong}>Account &amp; restaurant details</strong> — name, email
            address, restaurant name, location, and other profile information you enter when you
            create or manage an account.
          </p>
          <p style={S.pTight}>
            <strong style={S.strong}>Menu &amp; recipe data</strong> — menu items, recipes,
            ingredients, portion and yield information, and pricing you add or import (including
            via our menu parser).
          </p>
          <p style={S.pTight}>
            <strong style={S.strong}>Invoices &amp; supplier documents</strong> — invoice images
            and files you upload, and the line-item data extracted from them (vendor, item,
            quantity, unit cost, dates).
          </p>
          <p style={S.pTight}>
            <strong style={S.strong}>Billing information</strong> — your subscription plan and
            payment status. We use Stripe to process payments; card numbers are handled by Stripe
            and are not stored on our servers.
          </p>
          <p style={S.pTight}>
            <strong style={S.strong}>Support communications</strong> — messages, feedback, and
            other information you send us.
          </p>
        </div>

        <div style={S.subLabel}>Information from connected services</div>
        <p style={{ ...S.pTight, marginBottom: 28 }}>
          <strong style={S.strong}>Point-of-sale (POS) data</strong> — when you connect a POS
          provider (such as Shift4/SkyTab or Square), we receive sales and transaction data such
          as items sold, quantities, timestamps, and totals, used to rank popularity and estimate
          waste risk.
        </p>

        <div style={S.subLabel}>Information collected automatically</div>
        <div style={S.stackTight}>
          <p style={S.pTight}>
            <strong style={S.strong}>Usage &amp; device data</strong> — basic log information such
            as pages viewed, actions taken, approximate device and browser type, and timestamps,
            used to operate, secure, and improve the service.
          </p>
          <p style={S.pTight}>
            <strong style={S.strong}>NFC / staff briefing access</strong> — when staff tap an NFC
            tag to view a shift’s recommendations, we may log that the briefing page was accessed
            in order to operate the feature. These pages are designed to work without staff
            accounts or personal logins.
          </p>
        </div>
      </>
    ),
  },
  {
    id: 'use',
    heading: 'How we use information',
    body: (
      <>
        <p style={{ ...S.p, marginBottom: 16 }}>We use the information above to:</p>
        <Bullets
          items={[
            'generate Tonight’s Dish recommendations and the underlying waste-risk, popularity, and margin signals;',
            'parse and organize your invoices, menus, and ingredient data;',
            'create, authenticate, and manage your account and workspace;',
            'process subscriptions, billing, and renewals;',
            'provide customer support and respond to your requests;',
            'maintain, secure, troubleshoot, and improve the service;',
            'comply with legal obligations and enforce our terms.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'ai',
    heading: 'AI processing & how recommendations are generated',
    tocLabel: 'AI processing & recommendations',
    body: (
      <>
        <p style={{ ...S.p, marginBottom: 14 }}>
          OptiMenu’s core features rely on AI services to read documents and produce
          recommendations. Specifically, invoice images may be processed using optical character
          recognition (currently provided by Mistral), and recommendation and parsing logic uses
          the Anthropic (Claude) API. To deliver these features, relevant data — such as invoice
          contents, menu and recipe details, and aggregated sales signals — is transmitted to
          these providers solely to perform the requested processing and return results to your
          workspace.
        </p>
        <p style={S.p}>
          Recommendations are generated to assist your decision-making and are not a substitute
          for your own judgment regarding food safety, inventory, purchasing, or pricing. See our{' '}
          <Link href="/terms">Terms of Service</Link> for the full disclaimer on how to treat
          recommendations.
        </p>
      </>
    ),
  },
  {
    id: 'share',
    heading: 'How we share information',
    body: (
      <>
        <p style={{ ...S.p, marginBottom: 14 }}>
          <strong style={S.strong}>We do not sell your personal information.</strong> We share
          information only as described below:
        </p>
        <p style={{ ...S.p, marginBottom: 20 }}>
          <strong style={S.strong}>Service providers (subprocessors).</strong> We rely on trusted
          third parties to run OptiMenu. Each receives only the data needed to perform its
          function:
        </p>
        <div style={{ marginBottom: 24 }}>
          <SpecTable head={['Provider', 'Purpose']} rows={SUBPROCESSORS} />
        </div>
        <div style={S.stackTight}>
          <p style={S.pTight}>
            <strong style={S.strong}>Legal &amp; safety.</strong> We may disclose information if
            required by law, or to protect the rights, property, or safety of OptiMenu, our users,
            or others.
          </p>
          <p style={S.pTight}>
            <strong style={S.strong}>Business transfers.</strong> If OptiMenu is involved in a
            merger, acquisition, or sale of assets, information may be transferred as part of that
            transaction, subject to this policy.
          </p>
        </div>
      </>
    ),
  },
  {
    id: 'retention',
    heading: 'Data retention',
    body: (
      <p style={S.p}>
        We retain your information for as long as your account is active and as needed to provide
        the service. After you close your account, we delete or de-identify your data within a
        reasonable period, except where we must retain certain records to comply with legal, tax,
        accounting, or security obligations, or to resolve disputes. You can request deletion as
        described below.
      </p>
    ),
  },
  {
    id: 'security',
    heading: 'Security',
    body: (
      <p style={S.p}>
        We take reasonable measures to protect your information, including encryption of data in
        transit, row-level security and access controls on our database, and ownership checks that
        restrict each workspace’s data to authorized users. No method of transmission or storage is
        completely secure, so we cannot guarantee absolute security, but we work to protect your
        information and to address vulnerabilities promptly.
      </p>
    ),
  },
  {
    id: 'rights',
    heading: 'Your rights & choices',
    body: (
      <p style={S.p}>
        Depending on your location, you may have rights to access, correct, export, or delete your
        information, or to object to or restrict certain processing. To make a request, or to close
        your account and have associated data deleted, contact us at{' '}
        <a href="mailto:privacy@opti-menu.com">privacy@opti-menu.com</a>. We will respond
        consistent with applicable law. You can also manage or cancel your subscription from your
        account settings.
      </p>
    ),
  },
  {
    id: 'cookies',
    heading: 'Cookies & similar technologies',
    body: (
      <p style={S.p}>
        We use cookies and similar technologies that are necessary to keep you signed in, remember
        preferences, secure the service, and understand basic usage. You can control cookies
        through your browser settings; disabling certain cookies may affect how the service works.
      </p>
    ),
  },
  {
    id: 'integrations',
    heading: 'Third-party integrations & links',
    body: (
      <p style={S.p}>
        When you connect a third-party service (such as a POS provider) or follow a link to a
        third-party site, that third party’s own privacy practices apply to the information it
        collects. We are not responsible for the privacy practices of services we do not control.
        Review their policies before connecting or sharing data.
      </p>
    ),
  },
  {
    id: 'children',
    heading: 'Children',
    body: (
      <p style={S.p}>
        OptiMenu is intended for businesses and is not directed to children under 16. We do not
        knowingly collect personal information from children. If you believe a child has provided
        us information, contact us and we will take appropriate steps to delete it.
      </p>
    ),
  },
  {
    id: 'changes',
    heading: 'Changes to this policy',
    body: (
      <p style={S.p}>
        We may update this policy from time to time. When we do, we will revise the effective date
        above and, for material changes, provide additional notice where appropriate. Your
        continued use of OptiMenu after an update means you accept the revised policy.
      </p>
    ),
  },
  {
    id: 'contact',
    heading: 'Contact us',
    body: (
      <>
        <p style={{ ...S.p, marginBottom: 22 }}>
          Questions about this policy or your data? Reach us at{' '}
          <a href="mailto:privacy@opti-menu.com">privacy@opti-menu.com</a>
        </p>
        <MailButton email="privacy@opti-menu.com">Email the privacy team</MailButton>
      </>
    ),
  },
];

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      docNumber="01"
      effectiveDate={EFFECTIVE}
      description="How OptiMenu collects, uses, shares and protects restaurant data."
      otherDoc={{ href: '/terms', label: 'Terms' }}
      intro={
        <>
          OptiMenu Solutions LLC (“OptiMenu,” “we,” “us,” or “our”) provides a software platform
          that helps independent restaurant operators reduce food waste and improve margins,
          including our “Tonight’s Dish” recommendation engine. This policy explains what
          information we collect when you use OptiMenu, how we use it, who we share it with, and
          the choices you have. By using OptiMenu, you agree to the practices described here.
        </>
      }
      sections={SECTIONS}
    />
  );
}
