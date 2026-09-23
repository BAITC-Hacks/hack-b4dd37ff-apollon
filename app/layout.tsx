import type { Metadata } from "next";
import { Workspace } from "@/components/workspace";
import "./globals.css";

export const metadata: Metadata = { title: "Apollon — планирование закупок", description: "Объяснимый расчёт закупок IEK и Systeme Electric: спрос, остатки, поставки и утверждение заказа." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ru"><body><Workspace>{children}</Workspace></body></html>; }
