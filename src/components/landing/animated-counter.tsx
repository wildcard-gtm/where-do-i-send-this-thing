"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";

interface AnimatedCounterProps {
  value: string;
  label: string;
}

export default function AnimatedCounter({ value, label }: AnimatedCounterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const [displayValue, setDisplayValue] = useState("0");

  useEffect(() => {
    if (!isInView) return;

    // Extract numeric part and suffix
    const numMatch = value.match(/^([\d,.]+)/);
    const suffix = value.replace(/^[\d,.]+/, "");

    if (!numMatch) {
      setDisplayValue(value);
      return;
    }

    const target = parseFloat(numMatch[1].replace(/,/g, ""));
    const duration = 1500;
    const start = performance.now();
    const hasDecimal = numMatch[1].includes(".");
    const hasComma = numMatch[1].includes(",");

    function animate(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = target * eased;

      let formatted: string;
      if (hasDecimal) {
        formatted = current.toFixed(1);
      } else {
        const rounded = Math.round(current);
        formatted = hasComma
          ? rounded.toLocaleString()
          : rounded.toString();
      }

      setDisplayValue(formatted + suffix);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }

    requestAnimationFrame(animate);
  }, [isInView, value]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5 }}
      className="text-center"
    >
      <p className="text-3xl md:text-4xl font-bold text-foreground">
        {displayValue}
      </p>
      <p className="text-sm text-muted-foreground mt-1">{label}</p>
    </motion.div>
  );
}
