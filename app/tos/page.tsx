import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPageShell } from '@/components/LegalPageShell';

export const metadata: Metadata = {
  title: 'Terms of Service — Cadence',
  description: 'Terms for using the Cadence web application.',
};

export default function TermsPage() {
  return (
    <LegalPageShell title="Terms of Service">
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your use of Cadence at{' '}
        <a href="https://www.bridgerscadence.com">www.bridgerscadence.com</a> (the
        &quot;Service&quot;). By using Cadence, you agree to these
        Terms.
      </p>

      <h2>1. The Service</h2>
      <p>
        Cadence helps you plan tasks and view calendars. Optional features include connecting Google
        Calendar via OAuth, subscribing to a Cadence calendar feed, and importing ICS calendars.
        Features may change as the project evolves.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 13 years old to use Cadence. If you use Cadence on behalf of a school or
        organization, you confirm you have permission to do so.
      </p>

      <h2>3. Your account &amp; Google access</h2>
      <ul>
        <li>
          Cadence may store a local profile on your device. Connecting Google is optional and done
          through Google&apos;s OAuth consent flow.
        </li>
        <li>
          You are responsible for activity that occurs through your Google authorization and for
          keeping access to your devices secure.
        </li>
        <li>
          You can revoke Google access at any time in Google Account settings or by disconnecting
          inside Cadence.
        </li>
      </ul>

      <h2>4. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Misuse the Service, attempt to disrupt it, or access it in unauthorized ways.</li>
        <li>Use Cadence to violate applicable laws or Google&apos;s terms and policies.</li>
        <li>
          Attempt to scrape, reverse engineer, or overload systems beyond normal personal use,
          except as allowed by law.
        </li>
      </ul>

      <h2>5. Your content</h2>
      <p>
        You retain ownership of the tasks, events, and other content you create. You grant Cadence
        permission to process that content as needed to provide the Service (including storing local
        data, syncing with Google when you authorize it, and publishing feed data when you use feed
        features).
      </p>

      <h2>6. Third-party services</h2>
      <p>
        Cadence relies on third parties such as Google (Calendar / OAuth) and hosting providers. Your
        use of Google services is also subject to Google&apos;s terms and privacy policies. We are
        not responsible for third-party services we do not control.
      </p>

      <h2>7. Disclaimer</h2>
      <p>
        Cadence is provided &quot;as is&quot; for educational and personal productivity use, without
        warranties of any kind, express or implied, including fitness for a particular purpose or
        uninterrupted availability. Scheduling suggestions are assistive and may be inaccurate; you
        remain responsible for your own deadlines and commitments.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, the Cadence maintainers are not
        liable for indirect, incidental, special, consequential, or punitive damages, or for lost
        data, lost profits, or damages arising from your use of (or inability to use) the Service.
      </p>

      <h2>9. Changes &amp; termination</h2>
      <p>
        We may update these Terms or discontinue the Service at any time. Continued use after
        changes means you accept the updated Terms. We may suspend access if these Terms are
        violated.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about these Terms can be directed to the Cadence maintainers
        associated with{' '}
        <a href="https://www.bridgerscadence.com">www.bridgerscadence.com</a>, or via the developer
        contact email on the Google Cloud OAuth consent screen for this app.
      </p>

      <p>
        See also our <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </LegalPageShell>
  );
}
