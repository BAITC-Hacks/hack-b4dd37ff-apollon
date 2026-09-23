import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Workspace } from "@/components/workspace";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin", "cyrillic"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = { title: "Apollon · Электрокомплект", description: "Один экран: выберите данные, проверьте их, рассчитайте заказ IEK и Systeme Electric, скорректируйте количество и утвердите к экспорту." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ru" className={`${sans.variable} ${mono.variable}`}><body><Workspace>{children}</Workspace></body></html>; }
