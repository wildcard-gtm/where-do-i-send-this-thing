import Link from "next/link";
import EnvelopeHero from "@/components/landing/envelope-hero";
import HomepageContent from "@/components/landing/homepage-content";
import MobileNav from "@/components/landing/mobile-nav";
import SmoothScroll from "@/components/landing/smooth-scroll";

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#faq", label: "FAQ" },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-foreground">
      <SmoothScroll />
      {/* Navbar */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/70 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="WDISTT" className="w-8 h-auto" />
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
                <li>
                  <Link
                    href="/contact"
                    className="text-sm text-muted-foreground hover:text-foreground transition"
                  >
                    Contact
                  </Link>
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
                  <Link
                    href="/privacy"
                    className="text-sm text-muted-foreground hover:text-foreground transition"
                  >
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link
                    href="/terms"
                    className="text-sm text-muted-foreground hover:text-foreground transition"
                  >
                    Terms of Service
                  </Link>
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
              <img src="/logo.png" alt="WDISTT" className="w-6 h-auto" />
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
