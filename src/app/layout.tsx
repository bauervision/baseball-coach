import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ShellLayout } from "@/components/shell/ShellLayout";
import { AuthOverlay } from "@/components/auth/AuthOverlay";

import "./globals.css";
import AuthOverlayHost from "@/components/layout/AuthOverlayHost";
import { ThemeBoot } from "@/components/theme/ThemeBoot";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Baseball Coach",
  description: "Knexus app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeBoot />
        <AuthOverlayHost/>
        <AuthOverlay>
          <ShellLayout>{children}</ShellLayout>
          
        </AuthOverlay>
      </body>
    </html>
  );
}
