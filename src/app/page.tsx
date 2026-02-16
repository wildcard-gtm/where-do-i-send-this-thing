import Link from "next/link";
import FAQAccordion from "@/components/landing/faq-accordion";
import MobileNav from "@/components/landing/mobile-nav";

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const faqItems = [
  {
    question: "How accurate are the addresses?",
    answer:
      "Our system cross-references multiple sources for each lookup and assigns a confidence score. Most results come back with 85%+ confidence. You can see the confidence score for every address before using it.",
  },
  {
    question: "Is my data private and secure?",
    answer:
      "Absolutely. All lookups are stored in your private workspace and are never shared with other users. We use encryption in transit and at rest. Your contact data belongs to you.",
  },
  {
    question: "What are the main use cases?",
    answer:
      "Teams use WDISTT for direct mail campaigns, sending corporate gifts, holiday cards, event invitations, and booking in-person meetings. Anywhere you need a verified mailing address for a professional contact.",
  },
  {
    question: "Why HOME vs OFFICE — what's the difference?",
    answer:
      "Depending on the situation, mail or gifts land better at one address over the other. A holiday gift is more personal at home, while a business proposal fits an office. Our AI recommends the best option so your delivery actually gets noticed.",
  },
  {
    question: "How many contacts can I process at once?",
    answer:
      "You can upload batches of any size — just paste LinkedIn URLs or upload a CSV. Results are delivered in real-time as each contact is processed.",
  },
  {
    question: "Can I export the results?",
    answer:
      "Yes. Every batch can be exported as a CSV with all addresses, recommendations, and confidence scores included. Easy to import into your CRM or mailing tool.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-foreground">
      {/* Navbar */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-border">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <span className="text-lg font-bold text-foreground">WDISTT</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-foreground/60 hover:text-foreground transition"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Link
              href="/auth/signin"
              className="text-sm font-medium text-foreground/70 hover:text-foreground transition px-4 py-2"
            >
              Sign In
            </Link>
            <Link
              href="/dashboard"
              className="text-sm font-medium bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-lg transition"
            >
              Get Started
            </Link>
          </div>

          {/* Mobile nav */}
          <MobileNav links={navLinks} />
        </div>
      </header>

      {/* Hero */}
      <section className="py-20 md:py-32">
        <div className="max-w-4xl mx-auto px-4 md:px-6 text-center">
          <div className="inline-flex items-center gap-2 bg-primary-light text-primary text-sm font-medium px-4 py-1.5 rounded-full mb-6">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            AI-Powered Address Intelligence
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-foreground leading-tight mb-6 whitespace-nowrap">
            Know Exactly <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Where to Send It</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Turn LinkedIn profiles into verified delivery addresses. Our AI agent
            researches multiple data sources and recommends HOME vs OFFICE
            delivery for your marketing campaigns, gifts, and meeting requests.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/dashboard"
              className="bg-primary hover:bg-primary-hover text-white px-8 py-3.5 rounded-xl font-semibold text-base transition shadow-lg shadow-primary/25"
            >
              Start Free
            </Link>
            <Link
              href="#how-it-works"
              className="border border-border hover:border-foreground/20 text-foreground px-8 py-3.5 rounded-xl font-semibold text-base transition"
            >
              See How It Works
            </Link>
          </div>
        </div>
      </section>

      {/* Social Proof Stats */}
      <section className="bg-muted border-y border-border py-12">
        <div className="max-w-5xl mx-auto px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            <div>
              <p className="text-3xl md:text-4xl font-bold text-foreground">2,500+</p>
              <p className="text-sm text-muted-foreground mt-1">Addresses Verified</p>
            </div>
            <div>
              <p className="text-3xl md:text-4xl font-bold text-foreground">95%</p>
              <p className="text-sm text-muted-foreground mt-1">Accuracy Rate</p>
            </div>
            <div>
              <p className="text-3xl md:text-4xl font-bold text-foreground">3x</p>
              <p className="text-sm text-muted-foreground mt-1">Better Delivery Rate</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-4 md:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Everything You Need to Reach the Right Person
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              From LinkedIn URL to verified delivery address in minutes, not hours.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Feature 1 */}
            <div className="bg-white border border-border rounded-2xl p-6 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">LinkedIn Intake</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Paste LinkedIn URLs or upload a CSV. We extract profile data and start the research process automatically.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-white border border-border rounded-2xl p-6 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-violet-50 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">AI Discovery</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Our AI agent queries 5+ data sources including people search, property records, and web intelligence.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-white border border-border rounded-2xl p-6 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">HOME vs OFFICE</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Smart recommendation on whether to send to home or office, based on work patterns and location data.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="bg-white border border-border rounded-2xl p-6 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Batch Export</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Process hundreds of contacts at once and export verified addresses as CSV, ready for your campaigns.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 md:py-28 bg-muted">
        <div className="max-w-4xl mx-auto px-4 md:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              How It Works
            </h2>
            <p className="text-muted-foreground text-lg">
              Four simple steps from LinkedIn URL to verified delivery address.
            </p>
          </div>

          <div className="space-y-8">
            {[
              {
                step: 1,
                title: "Upload LinkedIn URLs",
                desc: "Paste a list of LinkedIn profile URLs or drag-and-drop a CSV file. Our system validates and deduplicates URLs automatically.",
              },
              {
                step: 2,
                title: "AI Agent Investigates",
                desc: "Our AI agent researches each person across multiple databases, property records, and web sources to build a complete address profile.",
              },
              {
                step: 3,
                title: "Review Results",
                desc: "See confidence-scored addresses with HOME vs OFFICE recommendations, interactive maps, and full agent reasoning for each contact.",
              },
              {
                step: 4,
                title: "Export & Ship",
                desc: "Download your verified addresses as CSV. Addresses are ready for mail campaigns, gift sending, or meeting scheduling.",
              },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-5">
                <div className="w-10 h-10 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm shrink-0">
                  {item.step}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">
                    {item.title}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 md:py-28">
        <div className="max-w-5xl mx-auto px-4 md:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Simple, Transparent Pricing
            </h2>
            <p className="text-muted-foreground text-lg">
              Start free. Scale as you grow.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Starter */}
            <div className="border border-border rounded-2xl p-8">
              <h3 className="text-lg font-semibold text-foreground mb-1">Starter</h3>
              <p className="text-sm text-muted-foreground mb-6">For trying it out</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-foreground">Free</span>
              </div>
              <ul className="space-y-3 mb-8">
                {["25 lookups/month", "CSV export", "Email support"].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/dashboard"
                className="block text-center border border-border hover:border-foreground/20 text-foreground px-6 py-2.5 rounded-lg font-medium transition text-sm"
              >
                Get Started
              </Link>
            </div>

            {/* Professional - highlighted */}
            <div className="border-2 border-primary rounded-2xl p-8 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-white text-xs font-semibold px-3 py-1 rounded-full">
                Most Popular
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-1">Professional</h3>
              <p className="text-sm text-muted-foreground mb-6">For growing teams</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-foreground">$99</span>
                <span className="text-muted-foreground text-sm">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                {[
                  "500 lookups/month",
                  "Contact database",
                  "AI chat per contact",
                  "Priority support",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/dashboard"
                className="block text-center bg-primary hover:bg-primary-hover text-white px-6 py-2.5 rounded-lg font-medium transition text-sm"
              >
                Start Free Trial
              </Link>
            </div>

            {/* Enterprise */}
            <div className="border border-border rounded-2xl p-8">
              <h3 className="text-lg font-semibold text-foreground mb-1">Enterprise</h3>
              <p className="text-sm text-muted-foreground mb-6">For large organizations</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-foreground">Custom</span>
              </div>
              <ul className="space-y-3 mb-8">
                {[
                  "Unlimited lookups",
                  "API access",
                  "Custom integrations",
                  "Dedicated support",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="mailto:sales@wdistt.com"
                className="block text-center border border-border hover:border-foreground/20 text-foreground px-6 py-2.5 rounded-lg font-medium transition text-sm"
              >
                Contact Sales
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20 md:py-28 bg-muted">
        <div className="max-w-3xl mx-auto px-4 md:px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Frequently Asked Questions
            </h2>
          </div>
          <FAQAccordion items={faqItems} />
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 md:py-28">
        <div className="max-w-3xl mx-auto px-4 md:px-6 text-center">
          <div className="bg-gradient-to-br from-primary to-accent rounded-3xl p-10 md:p-16">
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">
              Ready to improve your delivery rate?
            </h2>
            <p className="text-white/80 text-lg mb-8 max-w-xl mx-auto">
              Stop guessing where to send mail. Start reaching the right people at the right address.
            </p>
            <Link
              href="/dashboard"
              className="inline-block bg-white text-primary hover:bg-white/90 px-8 py-3.5 rounded-xl font-semibold transition"
            >
              Get Started for Free
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-12">
        <div className="max-w-6xl mx-auto px-4 md:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-4">Product</h4>
              <ul className="space-y-2">
                <li><Link href="#features" className="text-sm text-muted-foreground hover:text-foreground transition">Features</Link></li>
                <li><Link href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition">Pricing</Link></li>
                <li><Link href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition">FAQ</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-4">Company</h4>
              <ul className="space-y-2">
                <li><span className="text-sm text-muted-foreground">About</span></li>
                <li><span className="text-sm text-muted-foreground">Blog</span></li>
                <li><span className="text-sm text-muted-foreground">Careers</span></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-4">Resources</h4>
              <ul className="space-y-2">
                <li><span className="text-sm text-muted-foreground">Documentation</span></li>
                <li><span className="text-sm text-muted-foreground">API Reference</span></li>
                <li><span className="text-sm text-muted-foreground">Status</span></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-4">Legal</h4>
              <ul className="space-y-2">
                <li><span className="text-sm text-muted-foreground">Privacy Policy</span></li>
                <li><span className="text-sm text-muted-foreground">Terms of Service</span></li>
                <li><span className="text-sm text-muted-foreground">Security</span></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-primary rounded flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-foreground">WDISTT</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Built by Wildcard. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
