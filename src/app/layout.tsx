import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import "../styles/tallies.css";
import { AuthOverlayWrapper } from "@/components/auth/AuthOverlayWrapper";
import { ViewedSeasonProvider } from "@/lib/viewedSeason";
import { TeamScopeProvider } from "@/lib/teamScope";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Tallies wordmark face (SIL OFL 1.1, self-hosted; license alongside the
// font and at /licenses/BubblegumSans-OFL.txt). Not preloaded: only pages
// that show the wordmark download it.
const bubblegumSans = localFont({
  src: "./fonts/BubblegumSans-Regular-latin.woff2",
  variable: "--font-tallies",
  weight: "400",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Baseball Coach",
  description: "Knexus app",
};

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} ${bubblegumSans.variable} antialiased`}>
        <TeamScopeProvider>
          <ViewedSeasonProvider>
            <AuthOverlayWrapper>{props.children}</AuthOverlayWrapper>
          </ViewedSeasonProvider>
        </TeamScopeProvider>
      </body>
    </html>
  );
}
