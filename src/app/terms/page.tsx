import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | WDISTT",
  description: "Terms of Service for Where Do I Send This Thing? (WDISTT) — the rules and conditions governing use of our platform.",
};

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-border bg-white/70 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="WDISTT" className="w-8 h-auto" />
            <span className="text-lg font-bold text-foreground">WDISTT</span>
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors duration-200"
          >
            Back to Home
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 md:px-6 py-12 md:py-16">
        <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
          Terms of Service
        </h1>
        <p className="text-muted-foreground text-sm mb-10">
          Last updated: February 2025
        </p>

        <div className="space-y-8 text-foreground/90 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              1. Acceptance of Terms
            </h2>
            <p className="text-sm">
              By accessing or using WDISTT (&quot;Where Do I Send This Thing?&quot;), a
              service operated by Wildcard (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), you agree to
              be bound by these Terms of Service (&quot;Terms&quot;). If you do not agree to
              these Terms, you may not use the service. These Terms apply to all
              users, including individuals and businesses.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              2. Description of Service
            </h2>
            <p className="text-sm">
              WDISTT is an address verification platform that helps businesses find
              verified mailing addresses for their contacts. Users submit LinkedIn
              profile URLs, and our platform uses a combination of AI agents and
              third-party data sources to locate and verify associated mailing
              addresses. The service includes batch processing, contact management,
              and AI-assisted research capabilities.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              3. Account Registration
            </h2>
            <p className="text-sm mb-3">
              To use WDISTT, you must create an account by providing a valid email
              address, name, and password. You agree to:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1.5 ml-2">
              <li>Provide accurate and complete registration information</li>
              <li>Maintain the security of your account credentials</li>
              <li>Promptly notify us of any unauthorized use of your account</li>
              <li>Accept responsibility for all activity that occurs under your account</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              4. User Responsibilities
            </h2>
            <p className="text-sm mb-3">When using WDISTT, you agree to:</p>
            <ul className="list-disc list-inside text-sm space-y-1.5 ml-2">
              <li>Provide accurate and valid LinkedIn profile URLs</li>
              <li>Use the addresses and contact data obtained through our service only for lawful purposes</li>
              <li>Comply with all applicable laws and regulations, including data protection and anti-spam laws</li>
              <li>Not use the service for harassment, stalking, or any form of illegal contact</li>
              <li>Not attempt to circumvent any security measures or rate limits</li>
              <li>Not reverse engineer, decompile, or disassemble any part of the service</li>
              <li>Not resell, redistribute, or sublicense access to the service or its data without our written consent</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              5. Data Accuracy Disclaimer
            </h2>
            <p className="text-sm">
              <strong>
                Addresses and contact information provided through WDISTT are
                delivered on an &quot;as-is&quot; basis.
              </strong>{" "}
              While we strive to provide accurate and up-to-date information using
              multiple data sources and verification methods, we do not guarantee
              the accuracy, completeness, or reliability of any address or contact
              data returned by the service. Address information may be outdated,
              incomplete, or incorrect. It is your responsibility to verify any
              address before relying on it for critical purposes such as legal
              service, regulatory filings, or time-sensitive deliveries.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              6. Intellectual Property
            </h2>
            <p className="text-sm">
              The WDISTT platform, including its software, design, text, graphics,
              and other content, is owned by Wildcard and is protected by
              intellectual property laws. You retain ownership of the data you submit
              to the service (such as LinkedIn URLs). We retain ownership of all
              derived data, aggregated insights, and platform improvements generated
              through the operation of the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              7. Limitation of Liability
            </h2>
            <p className="text-sm">
              To the fullest extent permitted by applicable law, Wildcard and its
              officers, directors, employees, and agents shall not be liable for any
              indirect, incidental, special, consequential, or punitive damages,
              including but not limited to loss of profits, data, business
              opportunities, or goodwill, arising out of or in connection with your
              use of the service. Our total aggregate liability for any claims
              arising from or relating to the service shall not exceed the amount
              you paid us in the twelve (12) months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              8. Disclaimer of Warranties
            </h2>
            <p className="text-sm">
              THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT
              WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT
              LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
              PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE
              SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE, OR THAT ANY
              DEFECTS WILL BE CORRECTED.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              9. Account Termination
            </h2>
            <p className="text-sm">
              We reserve the right to suspend or terminate your account at any time,
              with or without notice, for any reason, including but not limited to
              violation of these Terms, suspected fraudulent or abusive activity, or
              extended inactivity. Upon termination, your right to use the service
              ceases immediately. We may, at our discretion, delete your account
              data after termination. You may also delete your account at any time by
              contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              10. Indemnification
            </h2>
            <p className="text-sm">
              You agree to indemnify, defend, and hold harmless Wildcard and its
              affiliates, officers, directors, employees, and agents from and
              against any claims, liabilities, damages, losses, and expenses
              (including reasonable attorney&apos;s fees) arising out of or in connection
              with your use of the service, your violation of these Terms, or your
              violation of any rights of a third party.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              11. Changes to Terms
            </h2>
            <p className="text-sm">
              We may modify these Terms at any time by posting the revised Terms on
              this page. Material changes will be communicated through the service or
              by email. Your continued use of the service after changes take effect
              constitutes your acceptance of the revised Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              12. Governing Law
            </h2>
            <p className="text-sm">
              These Terms shall be governed by and construed in accordance with the
              laws of the United States, without regard to conflict of law
              principles. Any disputes arising from or relating to these Terms or
              the service shall be resolved in the courts of competent jurisdiction
              within the United States.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              13. Contact Us
            </h2>
            <p className="text-sm">
              If you have any questions about these Terms of Service, please contact
              us at{" "}
              <a
                href="mailto:support@wdistt.com"
                className="text-primary hover:underline"
              >
                support@wdistt.com
              </a>
              .
            </p>
          </section>
        </div>

        {/* Footer links */}
        <div className="mt-16 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Built by Wildcard. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <Link
              href="/privacy"
              className="text-xs text-muted-foreground hover:text-foreground transition"
            >
              Privacy Policy
            </Link>
            <Link
              href="/contact"
              className="text-xs text-muted-foreground hover:text-foreground transition"
            >
              Contact
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
