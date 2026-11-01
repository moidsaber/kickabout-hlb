import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kickabout – 7-a-side organiser",
  description: "Pick a time, fill the pitch, split the cost.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0d1511" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh bg-slate-100 text-slate-900 antialiased">
        <main className="mx-auto max-w-lg px-4 py-5">{children}</main>
      </body>
    </html>
  );
}
