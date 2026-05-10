import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Report Canvas - Tesla Executive Report",
  description: "AI-powered interactive report canvas with real-time rendering",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" className="h-full antialiased">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
