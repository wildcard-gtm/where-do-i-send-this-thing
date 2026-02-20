"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import ScrollReveal, {
  StaggerContainer,
  StaggerItem,
} from "./scroll-reveal";
import AnimatedCounter from "./animated-counter";
import FAQAccordion from "./faq-accordion";

const features = [
  {
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
        />
      </svg>
    ),
    title: "LinkedIn-to-Address",
    desc: "Paste LinkedIn profile URLs or upload a CSV. We validate, deduplicate, and begin the verification process instantly.",
    color: "from-blue-500 to-blue-600",
    bg: "bg-blue-50",
    text: "text-blue-600",
  },
  {
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
    ),
    title: "Multi-Source Verification",
    desc: "We cross-reference 5+ data sources including people search databases, property records, and public records to verify every address.",
    color: "from-violet-500 to-violet-600",
    bg: "bg-violet-50",
    text: "text-violet-600",
  },
  {
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
        />
      </svg>
    ),
    title: "Home vs Office",
    desc: "Get a clear recommendation on where to send — home or office — based on verified work patterns and location intelligence.",
    color: "from-emerald-500 to-emerald-600",
    bg: "bg-emerald-50",
    text: "text-emerald-600",
  },
  {
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
        />
      </svg>
    ),
    title: "Batch Processing",
    desc: "Process hundreds of contacts at once with real-time progress tracking. Export verified addresses as CSV, ready for your campaigns.",
    color: "from-amber-500 to-amber-600",
    bg: "bg-amber-50",
    text: "text-amber-600",
  },
];

const steps = [
  {
    title: "Upload Your Contacts",
    desc: "Paste LinkedIn profile URLs or drag-and-drop a CSV file. Our system validates and deduplicates your list automatically.",
  },
  {
    title: "We Research & Verify",
    desc: "Each contact is cross-referenced across multiple databases, property records, and public sources to build a complete, verified address profile.",
  },
  {
    title: "Review Your Results",
    desc: "See confidence-scored addresses with home vs office recommendations, interactive maps, and a detailed research report for each contact.",
  },
  {
    title: "Export & Send",
    desc: "Download verified addresses as CSV, ready for direct mail campaigns, corporate gifting, event invitations, or meeting scheduling.",
  },
];


const faqItems = [
  {
    question: "How accurate are the addresses?",
    answer:
      "We cross-reference multiple data sources for every lookup and assign a confidence score. Most results come back with 85%+ confidence. You can review the confidence score and detailed report for each address before using it.",
  },
  {
    question: "Is my data private and secure?",
    answer:
      "Absolutely. All lookups are stored in your private workspace and are never shared with other users. We use encryption in transit and at rest. Your contact data belongs to you.",
  },
  {
    question: "What are the main use cases?",
    answer:
      "Teams use WDISTT for direct mail campaigns, corporate gifting, holiday cards, event invitations, legal service of process, and booking in-person meetings. Anywhere you need a verified mailing address for a professional contact.",
  },
  {
    question: "Why Home vs Office?",
    answer:
      "The right address depends on the situation. A holiday gift lands better at a home address, while a business proposal fits an office. We analyze each contact's profile and recommend the best option so your delivery actually gets noticed.",
  },
  {
    question: "How many contacts can I process at once?",
    answer:
      "You can upload batches of any size — just paste LinkedIn URLs or upload a CSV. Results are delivered in real-time with progress tracking as each contact is processed.",
  },
  {
    question: "Can I export the results?",
    answer:
      "Yes. Every batch can be exported as a CSV with all addresses, recommendations, and confidence scores included. Easy to import into your CRM, direct mail platform, or gifting tool.",
  },
];

export default function HomepageContent() {
  return (
    <>
      {/* Social Proof Stats */}
      <section className="py-16 bg-muted/50 border-y border-border/50">
        <div className="max-w-5xl mx-auto px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <AnimatedCounter value="2,500+" label="Addresses Verified" />
            <AnimatedCounter value="95%" label="Accuracy Rate" />
            <AnimatedCounter value="3x" label="Better Delivery Rate" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-4 md:px-6">
          <ScrollReveal>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                Verified Addresses, Delivered with Confidence
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                From LinkedIn profile to verified mailing address in minutes —
                not hours of manual research.
              </p>
            </div>
          </ScrollReveal>

          <StaggerContainer
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
            stagger={0.12}
          >
            {features.map((feat) => (
              <StaggerItem key={feat.title}>
                <div className="glass-feature p-6 h-full">
                  <div
                    className={`w-12 h-12 ${feat.bg} rounded-xl flex items-center justify-center mb-4 ${feat.text}`}
                  >
                    {feat.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {feat.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feat.desc}
                  </p>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 md:py-28 bg-muted/40">
        <div className="max-w-4xl mx-auto px-4 md:px-6">
          <ScrollReveal>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                How It Works
              </h2>
              <p className="text-muted-foreground text-lg">
                Four steps from LinkedIn profile to verified delivery
                address.
              </p>
            </div>
          </ScrollReveal>

          <div className="space-y-0">
            {steps.map((item, i) => (
              <ScrollReveal key={i} delay={i * 0.1}>
                <div className="flex items-start gap-5 relative pb-10">
                  {/* Connector line */}
                  {i < steps.length - 1 && <div className="step-line" />}

                  <motion.div
                    className="w-10 h-10 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm shrink-0 relative z-10 shadow-lg shadow-primary/20"
                    whileInView={{ scale: [0.5, 1.15, 1] }}
                    viewport={{ once: true }}
                    transition={{
                      delay: i * 0.15 + 0.2,
                      duration: 0.5,
                      ease: [0.25, 0.1, 0.25, 1],
                    }}
                  >
                    {i + 1}
                  </motion.div>
                  <div className="pt-1">
                    <h3 className="text-lg font-semibold text-foreground mb-1">
                      {item.title}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20 md:py-28 bg-muted/40">
        <div className="max-w-3xl mx-auto px-4 md:px-6">
          <ScrollReveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                Frequently Asked Questions
              </h2>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={0.15}>
            <FAQAccordion items={faqItems} />
          </ScrollReveal>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 md:py-28">
        <div className="max-w-3xl mx-auto px-4 md:px-6 text-center">
          <ScrollReveal>
            <div className="relative overflow-hidden rounded-3xl p-10 md:p-16">
              {/* Gradient bg */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary via-accent to-primary" />
              {/* Glass overlay */}
              <div className="absolute inset-0 bg-white/5 backdrop-blur-sm" />

              <div className="relative z-10">
                <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">
                  Stop guessing. Start delivering.
                </h2>
                <p className="text-white/80 text-lg mb-8 max-w-xl mx-auto">
                  Join teams that trust WDISTT to find verified mailing
                  addresses and reach the right people at the right place.
                </p>
                <Link
                  href="/dashboard"
                  className="group inline-flex items-center gap-2 bg-white text-primary hover:bg-white/90 px-8 py-3.5 rounded-xl font-semibold transition-all duration-300 hover:shadow-xl hover:shadow-white/20 hover:scale-[1.02]"
                >
                  Get Started for Free
                  <svg
                    className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 8l4 4m0 0l-4 4m4-4H3"
                    />
                  </svg>
                </Link>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </>
  );
}
