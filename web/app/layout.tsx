import type { Metadata, Viewport } from "next";
import TabBar from "./components/TabBar";
import "./globals.css";

export const metadata: Metadata = { title: "CutDeep" };

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2f2f32",
};

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
