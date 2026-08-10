import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://activetrack-court-beta.vishtat.chatgpt.site"),
  title: "ActiveTrack — Live Basketball Shot Counter",
  description: "Use your camera to count basketball makes, misses, and shooting percentage in real time.",
  openGraph: {
    title: "ActiveTrack — Your reps. Counted.",
    description: "Live basketball makes, misses, and shooting percentage from your camera.",
    images: [{ url: "/og.png", width: 1734, height: 909, alt: "ActiveTrack Court Vision Beta" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ActiveTrack — Your reps. Counted.",
    description: "Live basketball shot tracking from your camera.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#070a08",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
