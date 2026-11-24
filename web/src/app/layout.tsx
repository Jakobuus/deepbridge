import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AutoForeground } from "@/components/auto-foreground";
import "./globals.css";
import "./deepbridge.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DeepBridge — Evidence-Backed Warm Paths for Deep Tech",
  description:
    "Translate academic publications into commercial buyers, dated warm paths, and human-approved intro drafts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
      data-glass="lucite"
      data-glass-tint="onyx"
    >
      <body className="min-h-full flex flex-col font-sans bg-background text-foreground selection:bg-sky-500/30 selection:text-white">
        <AutoForeground />
        {children}
      </body>
    </html>
  );
}
