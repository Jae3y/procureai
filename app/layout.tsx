import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--font-bricolage", display: "swap" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "ProcureAI",
  description: "Buy in bulk with pooled money. Kora verifies every vendor, holds the money, and pays in two stages.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F6F3EC" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG" className={`${bricolage.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body>
        {children}
        {process.env.KORA_OFFLINE_DOUBLE === "1" ? (
          <div role="note" className="offline-banner">
            OFFLINE · KORA TEST DOUBLE — not connected to Kora. Add your sk_test_ key and run npm run dev.
          </div>
        ) : null}
      </body>
    </html>
  );
}
