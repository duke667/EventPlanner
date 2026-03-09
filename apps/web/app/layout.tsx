import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EventManager",
  description: "Backoffice fuer Eventplanung, Einladungen und Check-in.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
