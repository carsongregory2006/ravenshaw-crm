import Link from "next/link";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-2 px-4 py-10">
      <div className="mx-auto w-full max-w-[720px]">
        <Link href="/" className="mb-8 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-fg text-sm font-bold text-bg">R</span>
          <span className="text-sm font-semibold">Ravenshaw AI</span>
        </Link>
        <article className="legal rounded-lg border border-border bg-bg p-6 text-[14px] leading-relaxed text-fg-2 sm:p-8">
          {children}
        </article>
        <footer className="mt-6 flex gap-4 text-xs text-fg-3">
          <Link href="/privacy" className="hover:text-fg">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-fg">Terms of Service</Link>
          <a href="mailto:info@ravenshawai.com" className="hover:text-fg">info@ravenshawai.com</a>
        </footer>
      </div>
    </div>
  );
}
