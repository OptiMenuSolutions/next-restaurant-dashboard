// pages/terms.js
// OptiMenu terms of service. Copy is authoritative — layout comes from
// components/landing/LegalPage.
import LegalPage, {
  S, Bullets, Callout, MailButton,
} from '../components/landing/LegalPage';
import Link from 'next/link';

const EFFECTIVE = 'June 16, 2026';

const SECTIONS = [
  {
    id: 'accept',
    heading: 'Agreement to these terms',
    body: (
      <p style={S.p}>
        By accessing or using OptiMenu, you confirm that you can form a binding contract with us,
        that you are authorized to act on behalf of the restaurant or business you register, and
        that you accept these Terms on its behalf. If you are using OptiMenu as an authorized
        member of a restaurant’s account, the account holder’s acceptance of these Terms also
        applies to you.
      </p>
    ),
  },
  {
    id: 'service',
    heading: 'The service',
    body: (
      <p style={S.p}>
        OptiMenu is a software platform that helps independent restaurants reduce food waste and
        improve margins. Its central feature is the “Tonight’s Dish” recommendation engine, which
        suggests dishes to promote based on signals including waste risk, item popularity, and
        margin. Supporting features — invoice parsing, menu and ingredient management, analytics,
        and staff briefing tools — exist to feed and surface those recommendations. We may add,
        change, or remove features over time.
      </p>
    ),
  },
  {
    id: 'accounts',
    heading: 'Eligibility & accounts',
    headingGap: 16,
    body: (
      <Bullets
        items={[
          'You must be at least 18 years old and able to enter into contracts to use OptiMenu.',
          'You are responsible for the accuracy of the information you provide and for keeping your login credentials secure.',
          'You are responsible for all activity under your account, including actions by staff or others you authorize.',
          <>
            Notify us promptly at{' '}
            <a href="mailto:support@opti-menu.com">support@opti-menu.com</a> if you suspect
            unauthorized use of your account.
          </>,
        ]}
      />
    ),
  },
  {
    id: 'billing',
    heading: 'Subscriptions, pricing & billing',
    headingGap: 18,
    body: (
      <div style={S.stack}>
        <p style={S.pTight}>
          <strong style={S.strong}>Subscription.</strong> OptiMenu is offered on a recurring
          subscription basis. By subscribing, you authorize us and our payment processor to charge
          your payment method on a recurring basis until you cancel.
        </p>
        <p style={S.pTight}>
          <strong style={S.strong}>Pricing.</strong> Standard pricing is $79 per month. Eligible
          early customers may subscribe at a founding rate of $59 per month. Where offered, the
          founding rate applies as described at the time of sign-up; we will not change it for an
          active founding subscriber except as permitted in these Terms or as you otherwise agree.
        </p>
        <p style={S.pTight}>
          <strong style={S.strong}>Payment processing.</strong> Payments are processed by Stripe.
          You agree to Stripe’s applicable terms, and you are responsible for providing accurate,
          current billing information.
        </p>
        <p style={S.pTight}>
          <strong style={S.strong}>Renewal.</strong> Subscriptions renew automatically for
          successive periods at the then-current rate for your plan unless you cancel before the
          renewal date.
        </p>
        <p style={S.pTight}>
          <strong style={S.strong}>Cancellation.</strong> You may cancel at any time from your
          account settings. Cancellation stops future renewals; it takes effect at the end of your
          current billing period, and you retain access until then.
        </p>
        <p style={S.pTight}>
          <strong style={S.strong}>Refunds.</strong> Except where required by law, payments are
          non-refundable and we do not provide refunds or credits for partial periods.
        </p>
        <p style={S.pTight}>
          <strong style={S.strong}>Price changes.</strong> We may change standard pricing on a
          going-forward basis. We will give reasonable advance notice of any change that would
          affect your renewals.
        </p>
        <p style={S.pTight}>
          <strong style={S.strong}>Taxes.</strong> Stated prices do not include taxes. You are
          responsible for any applicable sales, use, or similar taxes.
        </p>
      </div>
    ),
  },
  {
    id: 'data',
    heading: 'Your data & content',
    body: (
      <>
        <p style={{ ...S.p, marginBottom: 14 }}>
          <strong style={S.strong}>You own your data.</strong> As between you and OptiMenu, you
          retain all rights to the data and content you provide or connect — including menus,
          recipes, invoices, and sales data (“Your Data”). You grant us a non-exclusive, worldwide
          license to host, process, transmit, and display Your Data as needed to operate and
          provide the service to you, including transmitting relevant data to the subprocessors
          described in our <Link href="/privacy">Privacy Policy</Link>.
        </p>
        <p style={S.p}>
          You represent that you have the rights necessary to provide Your Data to us and that
          doing so does not violate any law or third-party rights. We may use aggregated,
          de-identified data that does not identify you or your restaurant to operate, analyze, and
          improve the service.
        </p>
      </>
    ),
  },
  {
    id: 'third-party',
    heading: 'Third-party integrations',
    body: (
      <p style={S.p}>
        OptiMenu connects with third-party services, such as POS providers (for example,
        Shift4/SkyTab or Square) and payment processing. Those services are operated by third
        parties under their own terms and privacy policies, and their availability and accuracy are
        outside our control. We are not responsible for third-party services, and your use of them
        is at your own risk. If a third-party service changes or becomes unavailable, related
        OptiMenu features may be affected.
      </p>
    ),
  },
  {
    id: 'ai',
    heading: 'AI recommendations — important disclaimer',
    tocLabel: 'AI recommendations — disclaimer',
    headingGap: 18,
    body: (
      <Callout label="Advisory only">
        <p style={{ fontSize: 15.5, lineHeight: 1.85, color: '#40545a', marginBottom: 14 }}>
          <strong style={S.strong}>OptiMenu’s recommendations are advisory only.</strong> Tonight’s
          Dish suggestions, waste-risk estimates, margin figures, and other outputs are generated
          using automated and AI-based methods from the data available to us. They may be
          incomplete, inaccurate, or unsuitable for your circumstances.
        </p>
        <p style={{ fontSize: 15.5, lineHeight: 1.85, color: '#40545a' }}>
          You are solely responsible for all decisions you make in running your restaurant,
          including decisions about{' '}
          <strong style={S.strong}>
            food safety, spoilage, allergens, inventory, purchasing, staffing, and pricing.
          </strong>{' '}
          OptiMenu does not provide food-safety, culinary, legal, financial, or professional
          advice, and our outputs are not a substitute for your own judgment, professional advice,
          or applicable health and safety requirements. Always independently verify the condition
          and safety of any ingredient before use. We do not guarantee any particular result, level
          of accuracy, cost savings, or revenue from using OptiMenu.
        </p>
      </Callout>
    ),
  },
  {
    id: 'acceptable',
    heading: 'Acceptable use',
    body: (
      <>
        <p style={{ ...S.p, marginBottom: 16 }}>You agree not to:</p>
        <Bullets
          items={[
            'use OptiMenu for any unlawful purpose or in violation of these Terms;',
            'upload data you do not have the right to share, or that infringes others’ rights;',
            'attempt to access accounts, data, or systems that are not yours;',
            'reverse engineer, scrape, overload, or interfere with the service or its security;',
            'resell, sublicense, or provide the service to third parties except as expressly permitted; or',
            'misuse AI features, including attempts to extract underlying models or generate harmful content.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'ip',
    heading: 'Intellectual property',
    body: (
      <p style={S.p}>
        OptiMenu, including its software, design, branding, and content (excluding Your Data), is
        owned by OptiMenu Solutions LLC and protected by intellectual property laws. We grant you a
        limited, non-exclusive, non-transferable, revocable right to use the service during your
        subscription, solely for your restaurant’s internal business purposes. All rights not
        expressly granted are reserved. If you send us feedback or suggestions, you grant us the
        right to use them without obligation to you.
      </p>
    ),
  },
  {
    id: 'warranty',
    heading: 'Disclaimers',
    body: (
      <p style={S.p}>
        The service is provided “as is” and “as available,” without warranties of any kind, whether
        express, implied, or statutory, including implied warranties of merchantability, fitness for
        a particular purpose, title, and non-infringement. We do not warrant that the service will
        be uninterrupted, error-free, secure, or that outputs will be accurate or reliable. Some
        jurisdictions do not allow certain warranty exclusions, so some of the above may not apply
        to you.
      </p>
    ),
  },
  {
    id: 'liability',
    heading: 'Limitation of liability',
    body: (
      <>
        <p style={{ ...S.p, marginBottom: 14 }}>
          To the maximum extent permitted by law, OptiMenu Solutions LLC and its owners and
          affiliates will not be liable for any indirect, incidental, special, consequential,
          exemplary, or punitive damages, or for lost profits, revenue, data, or goodwill, or for
          food spoilage, waste, or business interruption, arising out of or relating to your use of
          (or inability to use) OptiMenu, even if advised of the possibility of such damages.
        </p>
        <p style={S.p}>
          To the maximum extent permitted by law, our total aggregate liability for any claim
          relating to the service will not exceed the amounts you paid to us for the service in the
          three (3) months immediately before the event giving rise to the claim. Some
          jurisdictions do not allow certain limitations, so some of the above may not apply to you.
        </p>
      </>
    ),
  },
  {
    id: 'indemnity',
    heading: 'Indemnification',
    body: (
      <p style={S.p}>
        You agree to indemnify and hold harmless OptiMenu Solutions LLC and its owners and
        affiliates from and against any claims, damages, losses, liabilities, and reasonable
        expenses (including legal fees) arising out of or related to your use of the service, Your
        Data, your violation of these Terms, or your violation of any law or third-party right.
      </p>
    ),
  },
  {
    id: 'termination',
    heading: 'Termination',
    body: (
      <p style={S.p}>
        You may stop using OptiMenu and cancel your subscription at any time. We may suspend or
        terminate your access if you breach these Terms, if required for security or legal reasons,
        or if we discontinue the service. Upon termination, your right to use the service ends.
        Sections that by their nature should survive — including data ownership, disclaimers,
        limitation of liability, indemnification, and governing law — survive termination. We will
        handle your data after termination as described in our{' '}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>
    ),
  },
  {
    id: 'changes',
    heading: 'Changes to the service & terms',
    body: (
      <p style={S.p}>
        We may modify the service and may update these Terms from time to time. When we make
        material changes, we will revise the effective date above and provide notice where
        appropriate. Your continued use of OptiMenu after changes take effect means you accept the
        updated Terms. If you do not agree, stop using the service and cancel your subscription.
      </p>
    ),
  },
  {
    id: 'law',
    heading: 'Governing law & disputes',
    body: (
      <p style={S.p}>
        These Terms are governed by the laws of the State of New Jersey, without regard to its
        conflict-of-laws rules. You agree that the state and federal courts located in Union
        County, New Jersey will have exclusive jurisdiction over any dispute arising out of or
        relating to these Terms or the service, and you consent to personal jurisdiction there,
        except where applicable law provides otherwise.
      </p>
    ),
  },
  {
    id: 'contact',
    heading: 'Contact',
    body: (
      <>
        <p style={{ ...S.p, marginBottom: 22 }}>
          Questions about these Terms? Reach us at{' '}
          <a href="mailto:support@opti-menu.com">support@opti-menu.com</a>.
        </p>
        <MailButton email="support@opti-menu.com">Email support</MailButton>
      </>
    ),
  },
];

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Service"
      docNumber="02"
      effectiveDate={EFFECTIVE}
      description="The terms governing use of the OptiMenu platform."
      otherDoc={{ href: '/privacy', label: 'Privacy' }}
      intro={
        <>
          These Terms of Service (“Terms”) are a binding agreement between you and OptiMenu
          Solutions LLC (“OptiMenu,” “we,” “us,” or “our”) governing your access to and use of the
          OptiMenu platform and related services. Please read them carefully. By creating an
          account or using OptiMenu, you agree to these Terms and to our{' '}
          <Link href="/privacy">Privacy Policy</Link>. If you do not agree, do not use the service.
        </>
      }
      sections={SECTIONS}
    />
  );
}
