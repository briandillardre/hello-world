import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VitalTrack — your health, one picture",
  description:
    "Unify your Garmin data, health history, and bloodwork into one preventative dashboard.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
