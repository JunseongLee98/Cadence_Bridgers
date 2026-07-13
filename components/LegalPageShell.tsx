import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';

export function LegalPageShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#373147] text-white">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-3 hover:opacity-90">
            <span className="relative h-10 w-[130px]">
              <Image
                src="/cadence-logo-white.png"
                alt="Cadence"
                fill
                priority
                className="object-contain"
              />
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-3 text-sm text-white/80">
            <Link href="/privacy" className="underline-offset-2 hover:text-white hover:underline">
              Privacy
            </Link>
            <Link href="/tos" className="underline-offset-2 hover:text-white hover:underline">
              Terms
            </Link>
            <Link href="/" className="underline-offset-2 hover:text-white hover:underline">
              App
            </Link>
          </nav>
        </div>

        <article className="rounded-2xl border border-white/10 bg-[#494262] p-6 shadow-xl sm:p-8">
          <h1 className="mb-2 text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mb-8 text-sm text-white/60">Last updated: July 13, 2026</p>
          <div className="space-y-6 text-[15px] leading-relaxed text-white/90 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-white [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_a]:underline [&_a]:underline-offset-2">
            {children}
          </div>
        </article>
      </div>
    </main>
  );
}
