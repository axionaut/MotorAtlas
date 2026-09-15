import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MotorAtlas — Global Vehicle Intelligence",
  description: "A provenance-first global automotive database, source ledger and comparison engine.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
