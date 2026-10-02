import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relay — send any link straight to GitHub or Google Drive",
  description:
    "Paste a download link and Relay transfers it server-side into a GitHub repo or Google Drive. Nothing touches your device.",
};

export const viewport: Viewport = { themeColor: "#070a12", colorScheme: "dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="text-slate-100 antialiased">{children}</body>
    </html>
  );
}
