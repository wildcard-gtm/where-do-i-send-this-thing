import Link from "next/link";
import EnvelopeHero from "@/components/landing/envelope-hero";
import HomepageContent from "@/components/landing/homepage-content";
import MobileNav from "@/components/landing/mobile-nav";

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-foreground">
      {/* Navbar */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/70 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                />
              </svg>
            </div>
            <span className="text-lg font-bold text-foreground">WDISTT</span>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-foreground/60 hover:text-foreground transition-colors duration-200"
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
              className="text-sm font-medium bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-primary/20"
            >
              Get Started
            </Link>
          </div>

          <MobileNav links={navLinks} />
        </div>
      </header>

      {/* Hero with 3D envelope */}
      <EnvelopeHero />

      {/* Rest of page content (client component for animations) */}
      <HomepageContent />

      {/* Footer */}
      <footer className="border-t border-border py-12 bg-white">
        <div className="max-w-6xl mx-auto px-4 md:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-4">
                Product
              </h4>
              <ul className="space-y-2">
                <li>
                  <Link
                    href="#features"
                    className="text-sm text-muted-foreground hover:text-foreground transition"
                  >
                    Features
                  </Link>
                </li>
                <li>
                  <Link
                    href="#pricing"
                    className="text-sm text-muted-foreground hover:text-foreground transition"
                  >
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link
                    href="#faq"
                    className="text-sm text-muted-foreground hover:text-foreground transition"
                  >
                    FAQ
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-4">
                Company
              </h4>
              <ul className="space-y-2">
                <li>
                  <span className="text-sm text-muted-foreground">About</span>
                </li>
                <li>
                  <span className="text-sm text-muted-foreground">Blog</span>
                </li>
                <li>
                  <span className="text-sm text-muted-foreground">
                    Careers
                  </span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-4">
                Resources
              </h4>
              <ul className="space-y-2">
                <li>
                  <span className="text-sm text-muted-foreground">
                    Documentation
                  </span>
                </li>
                <li>
                  <span className="text-sm text-muted-foreground">
                    API Reference
                  </span>
                </li>
                <li>
                  <span className="text-sm text-muted-foreground">Status</span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-4">
                Legal
              </h4>
              <ul className="space-y-2">
                <li>
                  <span className="text-sm text-muted-foreground">
                    Privacy Policy
                  </span>
                </li>
                <li>
                  <span className="text-sm text-muted-foreground">
                    Terms of Service
                  </span>
                </li>
                <li>
                  <span className="text-sm text-muted-foreground">
                    Security
                  </span>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-primary rounded flex items-center justify-center">
                <svg
                  className="w-3 h-3 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                  />
                </svg>
              </div>
              <span className="text-sm font-semibold text-foreground">
                WDISTT
              </span>
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
