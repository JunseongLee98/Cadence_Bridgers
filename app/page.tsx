import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';

export const metadata: Metadata = {
  title: 'Cadence — AI calendar for students',
  description:
    'Cadence helps students plan tasks around their real schedule. Optional Google Calendar connection lets you view calendars and sync Cadence tasks.',
};

/**
 * Public marketing / OAuth consent homepage.
 * Must stay publicly readable (no login) and clearly name the app "Cadence".
 */
export default function CadenceHomePage() {
  return (
    <main className="min-h-screen bg-[#373147] text-white">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <header className="mb-10 flex items-center justify-between gap-4">
          <Link href="/" className="relative h-10 w-[130px]" aria-label="Cadence home">
            <Image
              src="/cadence-logo-white.png"
              alt="Cadence"
              fill
              priority
              className="object-contain"
            />
          </Link>
          <nav className="flex flex-wrap items-center gap-3 text-sm text-white/80">
            <Link href="/privacy" className="underline-offset-2 hover:text-white hover:underline">
              Privacy
            </Link>
            <Link href="/tos" className="underline-offset-2 hover:text-white hover:underline">
              Terms
            </Link>
            <Link href="/app" className="underline-offset-2 hover:text-white hover:underline">
              Open Cadence
            </Link>
          </nav>
        </header>

        <section className="rounded-2xl border border-white/10 bg-[#494262] p-6 shadow-xl sm:p-8">
          <p className="mb-3 text-sm font-medium uppercase tracking-wide text-white/60">
            Capstone Bridgers
          </p>
          <h1 className="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">Cadence</h1>
          <p className="mb-4 text-xl font-semibold text-white/95">
            AI calendar for students
          </p>
          <p className="mb-6 text-[15px] leading-relaxed text-white/90">
            <strong>Cadence</strong> is a web app that helps students plan schoolwork around their
            real schedule. You add tasks and deadlines; Cadence breaks work into focus blocks and
            places them into free time on your calendar.
          </p>

          <div className="mb-8 flex flex-wrap gap-3">
            <Link
              href="/app"
              className="inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#373147] hover:bg-white/90"
            >
              Open Cadence
            </Link>
            <Link
              href="/privacy"
              className="inline-flex items-center justify-center rounded-lg border border-white/25 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10"
            >
              Privacy Policy
            </Link>
            <Link
              href="/tos"
              className="inline-flex items-center justify-center rounded-lg border border-white/25 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10"
            >
              Terms of Service
            </Link>
          </div>

          <div className="space-y-8 text-[15px] leading-relaxed text-white/90">
            <section>
              <h2 className="mb-2 text-xl font-semibold text-white">
                Purpose of the Cadence application
              </h2>
              <ul className="list-disc space-y-2 pl-5">
                <li>Create and track tasks with priorities and due dates</li>
                <li>Automatically schedule work into available time based on your work hours</li>
                <li>Show Cadence-scheduled blocks and other calendar events in one view</li>
                <li>Optionally connect Google Calendar or subscribe with an ICS feed</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-2 text-xl font-semibold text-white">
                How Cadence uses Google Calendar (optional)
              </h2>
              <p className="mb-3">
                You can use Cadence without Google. If you choose <strong>Connect Google Calendar</strong>,
                Cadence requests Google OAuth access only to provide these features:
              </p>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <strong>Read calendars you select</strong> so busy times are visible while Cadence
                  schedules tasks
                </li>
                <li>
                  <strong>Create and update events in a Cadence Google calendar</strong> (when sync
                  is enabled) so planned work appears in Google Calendar
                </li>
              </ul>
              <p className="mt-3">
                Cadence does not use Google user data for advertising. You can disconnect in the app
                or revoke access in your Google Account anytime. See the{' '}
                <Link href="/privacy" className="underline underline-offset-2">
                  Cadence Privacy Policy
                </Link>
                .
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-xl font-semibold text-white">No login required to learn about Cadence</h2>
              <p>
                This homepage, the{' '}
                <Link href="/privacy" className="underline underline-offset-2">
                  Privacy Policy
                </Link>
                , and the{' '}
                <Link href="/tos" className="underline underline-offset-2">
                  Terms of Service
                </Link>{' '}
                are public. You do not need an account to read them. Opening the Cadence app stores
                your schedule data on your device; Google sign-in is only used if you connect Google
                Calendar.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-xl font-semibold text-white">About</h2>
              <p>
                Cadence is developed for the Capstone Bridgers project at{' '}
                <a
                  href="https://www.bridgerscadence.com"
                  className="underline underline-offset-2"
                >
                  www.bridgerscadence.com
                </a>
                .
              </p>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
