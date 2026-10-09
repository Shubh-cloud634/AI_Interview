import { Logo } from '@/components/layout/logo';
import { LandingHeader } from '@/components/marketing/landing-header';
import { LandingHero } from '@/components/marketing/landing-hero';
import { MotionRoot } from '@/components/marketing/landing-motion';
import { Features, FinalCta, HowItWorks, Modes, Preview, Results } from '@/components/marketing/landing-sections';

export default function Landing() {
  return (
    <MotionRoot>
      <div className="relative overflow-x-clip">
        <LandingHeader />
        <main id="main">
          <LandingHero />
          <Features />
          <HowItWorks />
          <Preview />
          <Modes />
          <Results />
          <FinalCta />
        </main>

        <footer className="border-t border-border px-5 py-10">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-sm text-muted">
            <Logo />
            <p>Your resume and answers are private to your account. Delete them any time in Settings.</p>
          </div>
        </footer>
      </div>
    </MotionRoot>
  );
}
