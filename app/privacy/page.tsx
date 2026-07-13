import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPageShell } from '@/components/LegalPageShell';

export const metadata: Metadata = {
  title: 'Privacy Policy — Cadence',
  description: 'How Cadence handles your data when you use Google Calendar and the web app.',
};

export default function PrivacyPage() {
  return (
    <LegalPageShell title="Privacy Policy">
      <p>
        Cadence (&quot;we&quot;, &quot;our&quot;, or &quot;the app&quot;) is a calendar and task
        planning web application operated for the Capstone Bridgers project at{' '}
        <a href="https://www.bridgerscadence.com">www.bridgerscadence.com</a>. This Privacy Policy
        explains what information we process when you use Cadence, including when you connect a
        Google account.
      </p>

      <h2>1. Information we process</h2>
      <ul>
        <li>
          <strong>Local app data.</strong> Tasks, calendar events, scheduling preferences,
          notifications, and similar content you create in Cadence are stored primarily in your
          browser (for example, local storage on your device).
        </li>
        <li>
          <strong>Google account &amp; Calendar data.</strong> If you choose to connect Google
          Calendar, we request OAuth access so Cadence can read calendars you select and, when
          enabled, create or update events in a Cadence-managed Google calendar. We receive Google
          access and refresh tokens needed to perform those actions on your behalf.
        </li>
        <li>
          <strong>Calendar feed links.</strong> If you use Cadence&apos;s subscribe/feed feature, we
          may store a tokenized feed of your Cadence-scheduled events so external calendar apps can
          subscribe to it.
        </li>
        <li>
          <strong>Anonymous duration telemetry.</strong> When you complete a task and enter how long
          it took, Cadence may send an anonymous record (random device id, AI procedure step
          title/description/order when applicable, estimated minutes, actual minutes, and when the
          AI inferred a measurable work quantity for that step, the amount and unit such as pages or
          questions). This is not linked to your Google account, email, or username.
        </li>
        <li>
          <strong>Personalized learning profile (when signed in with Google).</strong> If you connect
          Google, Cadence uses your Google account id to store a per-user learning profile that
          tracks how your actual completion times compare with AI estimates (by work unit). This is
          used only to tailor future duration suggestions for you. Population research telemetry
          remains anonymous and separate.
        </li>
        <li>
          <strong>Technical data.</strong> Our hosting provider may automatically collect standard
          server logs (such as IP address, browser type, and request timestamps) when you visit the
          site.
        </li>
      </ul>

      <h2>2. How we use information</h2>
      <ul>
        <li>To provide Cadence features (scheduling, calendar display, Google sync).</li>
        <li>To maintain your session with Google Calendar after you authorize access.</li>
        <li>To publish your Cadence calendar feed when you use that feature.</li>
        <li>
          To study anonymous task completion times by AI-broken-down procedure steps (including
          AI-inferred work amounts and units when available) and improve scheduling estimates.
        </li>
        <li>
          When you are signed in with Google, to personalize AI duration estimates for your account
          based on your estimate-vs-actual history.
        </li>
        <li>To operate, secure, and improve the service.</li>
      </ul>
      <p>We do not sell your personal information.</p>

      <h2>3. Google user data</h2>
      <p>
        Cadence&apos;s use of information received from Google APIs adheres to the{' '}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>
      <p>
        Google Calendar data is used only to provide the calendar features you request in Cadence
        (viewing selected calendars and syncing Cadence tasks to Google when you enable that). We do
        not use Google user data for advertising.
      </p>

      <h2>4. Where data is stored</h2>
      <ul>
        <li>Most personal schedule content stays in your browser unless you sync or publish it.</li>
        <li>
          Google OAuth tokens used for Calendar are stored in your browser so Cadence can refresh
          access.
        </li>
        <li>
          Feed/sync features may store Cadence event data on our hosting/storage providers (for
          example Vercel and related storage) so your subscription URL can be served.
        </li>
      </ul>

      <h2>5. Sharing</h2>
      <p>
        We share data only as needed to run Cadence (for example with Google when you authorize
        Calendar access, and with infrastructure providers that host the app). We do not share your
        Google Calendar data with third parties for their own marketing.
      </p>

      <h2>6. Retention &amp; your choices</h2>
      <ul>
        <li>
          You can disconnect Google Calendar in Cadence settings, which clears local Google tokens
          from the browser.
        </li>
        <li>
          You can revoke Cadence&apos;s access at any time in your Google Account under{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
          >
            Third-party access
          </a>
          .
        </li>
        <li>
          Clearing site data in your browser removes local Cadence data stored on that device.
        </li>
      </ul>

      <h2>7. Children</h2>
      <p>
        Cadence is intended for students and general users. It is not directed at children under 13.
        Do not use the service if you are under 13.
      </p>

      <h2>8. Changes</h2>
      <p>
        We may update this Privacy Policy from time to time. The &quot;Last updated&quot; date at
        the top will change when we do. Continued use of Cadence after an update means you accept
        the revised policy.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions about this Privacy Policy or Cadence&apos;s handling of data can be sent through
        the Capstone Bridgers / Cadence project maintainers listed with the live site at{' '}
        <a href="https://www.bridgerscadence.com">www.bridgerscadence.com</a>, or via the contact
        email configured on the Google Cloud OAuth consent screen for this app.
      </p>

      <p>
        See also our <Link href="/tos">Terms of Service</Link>.
      </p>
    </LegalPageShell>
  );
}
