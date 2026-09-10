import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Проверка сайта",
  description: "Проверка сайта на основные автоматизированные требования MVP."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
