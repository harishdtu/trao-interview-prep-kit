import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Interview Prep Kit",
  description: "AI-assisted interview preparation, built around your job description and the company itself.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="max-w-5xl mx-auto px-6 py-10">{children}</div>
      </body>
    </html>
  );
}
