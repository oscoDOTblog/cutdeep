import type { Metadata } from "next";
import TabBar from "./components/TabBar";
import "./globals.css";

export const metadata: Metadata = { title: "cutdeep — name that battle remix" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
        <TabBar />
      </body>
    </html>
  );
}
