import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Workspace } from "@/components/workspace";
import "./globals.css";

const sans = Geist({ subsets: ["latin", "cyrillic"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = { title: "Apollon · Электрокомплект", description: "Один экран: выберите данные, проверьте их, рассчитайте заказ IEK и Systeme Electric, скорректируйте количество и утвердите к экспорту." };
export const viewport: Viewport = { themeColor: "#fafafa", colorScheme: "light" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ru" className={sans.variable}><body><Workspace>{children}</Workspace></body></html>; }
