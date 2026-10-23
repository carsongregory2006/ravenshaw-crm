import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service · Ravenshaw AI" };

const UPDATED = "October 23, 2026";

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="text-xs text-fg-3">Last updated: {UPDATED}</p>

      <p>
        These Terms of Service (&quot;Terms&quot;) govern your use of the websites, landing pages and customer relationship
        management application operated by Ravenshaw AI (&quot;Ravenshaw AI&quot;, &quot;we&quot;, &quot;us&quot;), based in Canada
        (the &quot;Service&quot;). By using the Service you agree to these Terms.
      </p>

      <h2>Use of the Service</h2>
      <ul>
        <li>The CRM application is for authorized Ravenshaw AI team members only. Accounts are personal; keep your
          credentials confidential and tell us promptly about any unauthorized use.</li>
        <li>You agree not to misuse the Service, including by attempting to access data you are not permitted to see,
          interfering with its operation, or using it to send unlawful or unsolicited messages.</li>
        <li>Communications sent through the Service must comply with applicable law, including Canada&apos;s Anti-Spam
          Legislation (CASL) and telemarketing rules.</li>
      </ul>

      <h2>Landing pages and forms</h2>
      <p>
        When you submit information through one of our pages, you confirm it is accurate and that you consent to us
        contacting you about your inquiry by phone, SMS or email. You can opt out at any time by replying STOP or using
        the unsubscribe option.
      </p>

      <h2>Third-party services</h2>
      <p>
        The Service connects to third-party services such as Google Calendar, Calendly, PandaDoc, Telnyx, Resend and
        Mercury. Your use of those services is also subject to their own terms. Information we receive from Google APIs
        is handled as described in our <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>Client engagements</h2>
      <p>
        Services we provide to clients are governed by the separate agreement, proposal or contract signed with that
        client. If that agreement conflicts with these Terms, the signed agreement controls.
      </p>

      <h2>Intellectual property</h2>
      <p>
        The Service, its software and content are owned by Ravenshaw AI or its licensors. You keep ownership of the data
        you submit, and you grant us the rights needed to operate the Service with it.
      </p>

      <h2>Disclaimers and limitation of liability</h2>
      <p>
        The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, to the extent permitted
        by law. To the maximum extent permitted by law, Ravenshaw AI is not liable for indirect, incidental, special or
        consequential damages, or for loss of data, revenue or profits, arising from your use of the Service.
      </p>

      <h2>Termination</h2>
      <p>We may suspend or end access to the Service at any time, for example if these Terms are breached.</p>

      <h2>Governing law</h2>
      <p>
        These Terms are governed by the laws of the Province of Ontario and the federal laws of Canada applicable there,
        and the courts of Ontario have exclusive jurisdiction over any dispute.
      </p>

      <h2>Changes</h2>
      <p>We may update these Terms. Continued use of the Service after changes means you accept the updated Terms.</p>

      <h2>Contact</h2>
      <p>
        Questions: <a href="mailto:info@ravenshawai.com">info@ravenshawai.com</a>.
      </p>
    </>
  );
}
