import type { Metadata, Viewport } from "next";
import { appConfig } from "@/app.config";
import "./globals.css";

export const metadata: Metadata = {
  title: `${appConfig.name} — ${appConfig.tagline}`,
  description: appConfig.description,
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0b1224",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
