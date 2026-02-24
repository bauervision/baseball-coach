"use client";

import * as React from "react";
import { motion } from "framer-motion";

export function AnimatedBackgroundSkin() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{ background: "var(--bg-base)" }}
      />

      <motion.div
        className="bg-blob-1 absolute -left-[20%] top-[-30%] h-[70%] w-[70%] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, color-mix(in oklab, var(--secondary) 35%, transparent), transparent 62%)",
        }}
        initial={{ opacity: 0.35, scale: 0.95 }}
        animate={{
          opacity: [0.28, 0.42, 0.28],
          scale: [0.95, 1.05, 0.95],
          x: ["0%", "8%", "0%"],
          y: ["0%", "6%", "0%"],
        }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden="true"
      />

      <motion.div
        className="bg-blob-2 absolute -right-[25%] bottom-[-25%] h-[70%] w-[70%] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, color-mix(in oklab, var(--primary) 28%, transparent), transparent 66%)",
        }}
        initial={{ opacity: 0.28, scale: 0.96 }}
        animate={{
          opacity: [0.22, 0.36, 0.22],
          scale: [0.96, 1.06, 0.96],
          x: ["0%", "-10%", "0%"],
          y: ["0%", "-6%", "0%"],
        }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden="true"
      />

      <div
        className="bg-diamonds absolute inset-0"
        style={{
          opacity: 0.12, // tweak this
          backgroundImage: [
            "repeating-linear-gradient(45deg, color-mix(in oklab, var(--primary) 55%, transparent) 0px, color-mix(in oklab, var(--secondary) 55%, transparent) 1px, transparent 1px, transparent 46px)",
            "repeating-linear-gradient(-45deg, color-mix(in oklab, var(--secondary) 55%, transparent) 0px, color-mix(in oklab, var(--primary) 55%, transparent) 1px, transparent 1px, transparent 46px)",
          ].join(", "),
          backgroundSize: "92px 92px",
        }}
        aria-hidden="true"
      />

      <style jsx>{`
        /* Light theme: calm everything down */
        :global(html:not(.dark)) .bg-blob-1 {
          opacity: 0.2 !important;
          filter: blur(60px) saturate(0.9);
        }
        :global(html:not(.dark)) .bg-blob-2 {
          opacity: 0.16 !important;
          filter: blur(60px) saturate(0.9);
        }

        /* Dark theme keeps “screen” punch */
        :global(html.dark) .bg-grid,
        
      `}</style>
    </div>
  );
}
