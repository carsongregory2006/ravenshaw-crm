import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy · Ravenshaw AI" };

const UPDATED = "October 23, 2026";

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="text-xs text-fg-3">Last updated: {UPDATED}</p>

      <p>
        This Privacy Policy explains how Ravenshaw AI (&quot;Ravenshaw AI&quot;, &quot;we&quot;, &quot;us&quot;), based in Canada,
        collects, uses and protects information in connection with our customer relationship management application and
        related landing pages (the &quot;Service&quot;). We handle personal information in accordance with Canada&apos;s
        Personal Information Protection and Electronic Documents Act (PIPEDA) and applicable provincial law.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Account information:</strong> name, email address and role of team members who sign in to the Service.</li>
        <li><strong>Business contact information:</strong> names, phone numbers, email addresses, company details and notes about
          leads and clients, including information submitted through our landing page forms.</li>
        <li><strong>Communications:</strong> calls, SMS messages and emails sent or received through the Service, along with
          delivery status and, where enabled, call recordings.</li>
        <li><strong>Billing and contract records:</strong> deals, invoices, payments and contract status.</li>
        <li><strong>Google Calendar data:</strong> described in the next section.</li>
        <li><strong>Technical data:</strong> basic logs (such as IP address, browser type and timestamps) needed to operate and secure the Service.</li>
      </ul>

      <h2>Google Calendar data</h2>
      <p>
        If a team member chooses to connect their Google account, the Service requests access to Google Calendar
        (<code>https://www.googleapis.com/auth/calendar</code>) and their basic Google profile (email address) through
        Google OAuth. With that access we:
      </p>
      <ul>
        <li>read the list of their calendars and the events on them (titles, times, descriptions, locations, attendees and
          conference links) so their schedule appears in the CRM calendar;</li>
        <li>create, update and delete events on their Google Calendar only when they create, edit or delete those events
          in the CRM, so the two calendars stay in sync; and</li>
        <li>store OAuth tokens securely so syncing can continue until they disconnect.</li>
      </ul>
      <p>
        <strong>Google Calendar data is used only to sync and display scheduling inside the Service.</strong> We do not
        sell Google user data, we do not share or transfer it to third parties (other than the infrastructure providers
        that host the Service on our behalf, as needed to provide it), we do not use it for advertising, and we do not
        use it to train artificial intelligence or machine learning models. No human at Ravenshaw AI reads this data
        unless the user gives us permission, it is necessary for security or to comply with law.
      </p>
      <p>
        Ravenshaw AI&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
          Google API Services User Data Policy
        </a>, including the Limited Use requirements.
      </p>
      <p>
        You can disconnect Google Calendar at any time from the CRM calendar, or revoke access at{" "}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>.
        When access is revoked or you ask us to, we delete the stored tokens and synced Google events.
      </p>

      <h2>How we use information</h2>
      <ul>
        <li>to provide and operate the Service: managing leads and clients, scheduling, contracts, invoicing and communications;</li>
        <li>to respond to inquiries and deliver the services our clients have engaged us for;</li>
        <li>to secure the Service, prevent abuse and comply with legal obligations.</li>
      </ul>
      <p>We do not sell personal information.</p>

      <h2>Service providers</h2>
      <p>
        We use trusted providers to run the Service, which process data on our behalf: Supabase (database and
        authentication), Vercel (hosting), Telnyx (calls and SMS), Resend (email), Calendly (bookings), PandaDoc
        (contracts), Mercury (invoicing and payments) and OpenRouter (AI features applied to CRM records; Google Calendar
        data is not sent to it). Some of these providers store data outside Canada, including in the United States, where
        it may be subject to local law.
      </p>

      <h2>Retention and security</h2>
      <p>
        We keep information for as long as needed for the purposes above or as required by law, then delete or
        anonymize it. Data is encrypted in transit, access is restricted by role, and secrets are stored server-side only.
      </p>

      <h2>Your choices and rights</h2>
      <p>
        You may request access to, correction of, or deletion of your personal information, and you may withdraw consent
        to commercial electronic messages at any time (for example by replying STOP to SMS or using the unsubscribe
        option in our emails), in line with Canada&apos;s Anti-Spam Legislation (CASL).
      </p>

      <h2>Changes</h2>
      <p>We may update this policy. The &quot;Last updated&quot; date above shows when it last changed.</p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <a href="mailto:info@ravenshawai.com">info@ravenshawai.com</a>.
      </p>
    </>
  );
}
