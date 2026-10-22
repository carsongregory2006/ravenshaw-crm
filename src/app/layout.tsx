import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "Ravenshaw AI", template: "%s · Ravenshaw AI" },
  description: "Ravenshaw AI CRM",
};

// Applies the saved theme before paint to avoid a flash.
// Rendered per request so the browser always receives the current Supabase settings.
export const dynamic = "force-dynamic";

// Read at runtime via computed keys so the build never freezes them in.
function supabaseEnvScript() {
  const env = process.env;
  const urlKey = "NEXT_PUBLIC_SUPABASE_URL";
  const anonKey = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
  const payload = JSON.stringify({ url: env[urlKey] ?? "", anonKey: env[anonKey] ?? "" }).replace(/</g, "\\u003c");
  return `window.__SUPABASE_ENV__=${payload}`;
}

const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: supabaseEnvScript() }} />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} font-sans`}>
        {children}
        <Toaster position="bottom-right" toastOptions={{ className: "!text-[13px]" }} />
      </body>
    </html>
  );
}
