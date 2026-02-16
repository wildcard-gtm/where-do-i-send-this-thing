import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | WDISTT",
  description: "Privacy policy for Where Do I Send This Thing? (WDISTT) — how we collect, use, and protect your data.",
};

export default function PrivacyPolicyPage() {
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
          Privacy Policy
        </h1>
        <p className="text-muted-foreground text-sm mb-10">
          Last updated: February 2025
        </p>

        <div className="space-y-8 text-foreground/90 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              1. Introduction
            </h2>
            <p className="text-sm">
              WDISTT (&quot;Where Do I Send This Thing?&quot;) is a B2B SaaS platform operated
              by Wildcard (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;). This Privacy Policy explains how
              we collect, use, disclose, and safeguard your information when you use our
              service. By accessing or using WDISTT, you agree to this Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              2. Information We Collect
            </h2>
            <p className="text-sm mb-3">
              We collect the following types of information:
            </p>
            <h3 className="text-base font-medium text-foreground mb-2">
              2.1 Account Information
            </h3>
            <p className="text-sm mb-3">
              When you create an account, we collect your name, email address, and
              password. Passwords are securely hashed and never stored in plain text.
            </p>
            <h3 className="text-base font-medium text-foreground mb-2">
              2.2 LinkedIn URLs and Contact Data
            </h3>
            <p className="text-sm mb-3">
              You provide LinkedIn profile URLs through our platform. We process these
              URLs to find and verify mailing addresses for your contacts using
              third-party data sources. The resulting contact records &mdash; including
              names, addresses, company information, and job titles &mdash; are stored in
              your account.
            </p>
            <h3 className="text-base font-medium text-foreground mb-2">
              2.3 Chat Messages
            </h3>
            <p className="text-sm mb-3">
              When you use our AI-assisted chat feature to gather information about
              contacts, we store the conversation messages associated with your contact
              records.
            </p>
            <h3 className="text-base font-medium text-foreground mb-2">
              2.4 Usage Data
            </h3>
            <p className="text-sm">
              We may collect basic technical information necessary for the operation of
              the service, such as server logs, IP addresses, and browser type. We do not
              currently use any third-party analytics or tracking services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              3. How We Use Your Information
            </h2>
            <p className="text-sm mb-3">We use the information we collect to:</p>
            <ul className="list-disc list-inside text-sm space-y-1.5 ml-2">
              <li>Provide, operate, and maintain our services</li>
              <li>Process LinkedIn URLs and deliver address verification results</li>
              <li>Manage your account and authenticate your sessions</li>
              <li>Store and organize your contact records</li>
              <li>Communicate with you about your account or our services</li>
              <li>Improve and develop new features for our platform</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              4. Third-Party Data Sources
            </h2>
            <p className="text-sm">
              To provide address verification services, we use third-party data
              providers to look up and verify mailing addresses associated with the
              LinkedIn profiles you submit. We share only the minimum information
              necessary (such as names and LinkedIn URLs) with these providers to
              perform the lookup. We do not control the data practices of these
              third-party providers, and we encourage you to review their respective
              privacy policies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              5. Cookies and Authentication
            </h2>
            <p className="text-sm">
              We use JSON Web Tokens (JWT) stored in cookies solely for the purpose of
              authenticating your sessions. These cookies are essential for the
              operation of the service and are not used for tracking or advertising
              purposes. We do not use any third-party advertising cookies, tracking
              pixels, or similar technologies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              6. Data Sharing and Selling
            </h2>
            <p className="text-sm">
              <strong>We do not sell your personal data.</strong> We do not share your
              information with third parties for their marketing purposes. We may share
              information only in the following circumstances:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1.5 ml-2 mt-3">
              <li>With third-party data providers as described in Section 4, solely to provide our services</li>
              <li>When required by law, legal process, or government request</li>
              <li>To protect our rights, property, or safety, or the rights, property, or safety of others</li>
              <li>In connection with a merger, acquisition, or sale of all or a portion of our assets</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              7. Data Security
            </h2>
            <p className="text-sm">
              We implement reasonable administrative, technical, and physical security
              measures to protect your information. Passwords are hashed using
              industry-standard algorithms, and data is transmitted over encrypted
              connections (HTTPS). However, no method of transmission or storage is
              100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              8. Data Retention
            </h2>
            <p className="text-sm">
              We retain your account information and contact data for as long as your
              account is active or as needed to provide our services. If you delete your
              account, we will remove your personal data within a reasonable time frame,
              except where we are required to retain it for legal or legitimate business
              purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              9. Your Rights
            </h2>
            <p className="text-sm mb-3">
              Depending on your jurisdiction, you may have the right to:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1.5 ml-2">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Object to or restrict certain processing of your data</li>
              <li>Export your data in a portable format</li>
            </ul>
            <p className="text-sm mt-3">
              To exercise any of these rights, please contact us using the information
              below.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              10. Changes to This Policy
            </h2>
            <p className="text-sm">
              We may update this Privacy Policy from time to time. We will notify you of
              any material changes by posting the updated policy on this page with a
              revised &quot;Last updated&quot; date. Your continued use of the service after any
              changes constitutes your acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              11. Contact Us
            </h2>
            <p className="text-sm">
              If you have any questions about this Privacy Policy or our data practices,
              please contact us at{" "}
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
              href="/terms"
              className="text-xs text-muted-foreground hover:text-foreground transition"
            >
              Terms of Service
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
