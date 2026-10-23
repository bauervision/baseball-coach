import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthOverlayWrapper } from "@/components/auth/AuthOverlayWrapper";
import { ViewedSeasonProvider } from "@/lib/viewedSeason";

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

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ViewedSeasonProvider>
          <AuthOverlayWrapper>{props.children}</AuthOverlayWrapper>
        </ViewedSeasonProvider>
      </body>
    </html>
  );
}