import "./globals.css";
import type { Metadata } from "next";
import { Nav } from "./nav";

export const metadata: Metadata = {
  title: "Interaction points",
  description: "Pickup and drop-off desks for the medicine delivery pilot.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
