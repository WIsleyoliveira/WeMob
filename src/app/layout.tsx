import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Sansol Mob — Eletropostos completos para o seu negócio", template: "%s · Sansol Mob" },
  description:
    "Projeto completo de eletroposto para postos, supermercados, estacionamentos e empresas: estudo de viabilidade, implantação, sistema de gestão, suporte e manutenção.",
  openGraph: { type: "website", locale: "pt_BR", siteName: "Sansol Mob" },
};

export const viewport: Viewport = { themeColor: "#0d1828", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} ${manrope.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
