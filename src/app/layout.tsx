import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import { themeInitScript } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "Digital Meter Logbook — Factory Energy Tracking",
  description:
    "Track electricity usage across multiple meters and submeters. Industrial-grade meter logbook for factory energy management.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* Runs before paint to apply the persisted theme and avoid a flash */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
