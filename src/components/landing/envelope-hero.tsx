"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

export default function EnvelopeHero() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    // Trigger envelope open after mount
    const t1 = setTimeout(() => setHasLoaded(true), 300);
    const t2 = setTimeout(() => setIsOpen(true), 1200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0 hero-gradient" />

      {/* Floating orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 md:px-6 flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
        {/* Text content */}
        <motion.div
          className="flex-1 text-center lg:text-left"
          initial={{ opacity: 0, y: 30 }}
          animate={hasLoaded ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <motion.div
            className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 text-white/90 text-sm font-medium px-4 py-1.5 rounded-full mb-6"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={hasLoaded ? { opacity: 1, scale: 1 } : {}}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            AI-Powered Address Intelligence
          </motion.div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6">
            Know Exactly{" "}
            <span className="bg-gradient-to-r from-blue-300 via-purple-300 to-pink-300 bg-clip-text text-transparent">
              Where to Send It
            </span>
          </h1>

          <p className="text-base md:text-lg text-white/70 max-w-lg mb-8 leading-relaxed mx-auto lg:mx-0">
            Turn LinkedIn profiles into verified delivery addresses. Our AI
            researches multiple sources and recommends HOME vs OFFICE for your
            campaigns, gifts, and outreach.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
            <Link
              href="/dashboard"
              className="group bg-white text-slate-900 px-7 py-3.5 rounded-xl font-semibold text-base transition-all duration-300 shadow-lg shadow-white/10 hover:shadow-xl hover:shadow-white/20 hover:scale-[1.02] inline-flex items-center justify-center gap-2"
            >
              Start Free
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
            <Link
              href="#how-it-works"
              className="border border-white/25 hover:border-white/50 text-white px-7 py-3.5 rounded-xl font-semibold text-base transition-all duration-300 hover:bg-white/5 inline-flex items-center justify-center"
            >
              See How It Works
            </Link>
          </div>
        </motion.div>

        {/* 3D Envelope */}
        <motion.div
          className="flex-shrink-0"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={hasLoaded ? { opacity: 1, scale: 1 } : {}}
          transition={{ delay: 0.4, duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <div className="envelope-scene">
            <div className={`envelope-3d ${isOpen ? "open" : ""}`}>
              {/* Back */}
              <div className="env-back" />

              {/* Letter sliding out */}
              <div className="env-letter">
                <div className="env-letter-inner">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                      <svg
                        className="w-3.5 h-3.5 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                    <span className="text-sm font-bold text-slate-800">
                      Address Verified
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="h-2 bg-slate-200 rounded-full w-3/4" />
                    <div className="h-2 bg-slate-100 rounded-full w-1/2" />
                    <div className="flex items-center gap-2 mt-3">
                      <div className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-semibold rounded-full">
                        HOME
                      </div>
                      <div className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-semibold rounded-full">
                        95% confidence
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Front bottom */}
              <div className="env-front" />

              {/* Flap (top) */}
              <div className="env-flap" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2, duration: 0.5 }}
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          className="w-6 h-10 rounded-full border-2 border-white/30 flex items-start justify-center p-1.5"
        >
          <div className="w-1.5 h-2.5 bg-white/50 rounded-full" />
        </motion.div>
      </motion.div>
    </section>
  );
}
