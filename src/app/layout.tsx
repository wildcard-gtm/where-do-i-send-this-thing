import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "WDISTT | Where Do I Send This Thing?",
  description: "Find verified mailing addresses for your contacts. Paste a LinkedIn URL, get a deliverable address. Built for outbound sales and gifting teams.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://where-do-i-send-this-thing-git-main-wildcard-tech.vercel.app"),
  openGraph: {
    title: "WDISTT | Where Do I Send This Thing?",
    description: "Find verified mailing addresses for your contacts. Paste a LinkedIn URL, get a deliverable address.",
    type: "website",
    siteName: "WDISTT",
    images: ["/logo.png"],
  },
  twitter: {
    card: "summary",
    title: "WDISTT | Where Do I Send This Thing?",
    description: "Find verified mailing addresses for your contacts. Paste a LinkedIn URL, get a deliverable address.",
    images: ["/logo.png"],
  },
  keywords: ["address lookup", "LinkedIn address finder", "mailing address", "delivery address", "outbound sales", "gifting", "verified addresses"],
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
