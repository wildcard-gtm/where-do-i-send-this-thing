import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "WDISTT | Where Do I Send This Thing?",
  description: "Find verified mailing addresses for your contacts. Paste a LinkedIn URL, get a deliverable address. Built for outbound sales and gifting teams.",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "WDISTT | Where Do I Send This Thing?",
    description: "Find verified mailing addresses for your contacts. Paste a LinkedIn URL, get a deliverable address.",
    type: "website",
    images: ["/logo.png"],
  },
  twitter: {
    card: "summary",
    title: "WDISTT | Where Do I Send This Thing?",
    description: "Find verified mailing addresses for your contacts. Paste a LinkedIn URL, get a deliverable address.",
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
