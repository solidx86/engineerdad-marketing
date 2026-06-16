import "./globals.css";
import { LeftNav } from "./components/LeftNav";

export const metadata = { title: "EngineerDad — Webapp" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 min-h-screen">
        <div className="flex">
          <LeftNav />
          <main className="flex-1 p-8 max-w-6xl">{children}</main>
        </div>
      </body>
    </html>
  );
}
