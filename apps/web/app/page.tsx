import { ArrowRight, BarChart3, Brain, Briefcase, Code2, FileText, MessagesSquare, Scale, ShieldCheck, Target, Timer } from 'lucide-react';
import { Logo } from '@/components/layout/logo';
import { LandingHero } from '@/components/marketing/landing-hero';
import { Reveal, TiltCard } from '@/components/marketing/landing-motion';
import { ButtonLink } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

const features = [
  { icon: FileText, title: 'Starts from your resume', body: 'Your experience and skills decide which questions you get and how hard they are. Nothing generic.' },
  { icon: MessagesSquare, title: 'A real interviewer', body: 'One question at a time, with follow-ups that build on what you actually said.' },
  { icon: Code2, title: 'Live coding rounds', body: 'Write and run code in an isolated sandbox. Hidden tests stay hidden, like the real thing.' },
  { icon: Scale, title: 'Scored against a rubric', body: 'Every score links back to a quote from your answer and a published criterion.' },
  { icon: Target, title: 'A path to the role', body: 'See how close you are to your target roles, what is missing, and what to practise next.' },
  { icon: ShieldCheck, title: 'Private by default', body: 'Your resume and answers belong to your account. Delete them any time.' },
];

const steps = [
  { n: '01', title: 'Bring your background', body: 'Upload a resume. We separate what it states from what we infer, and let you correct either.' },
  { n: '02', title: 'Choose your interview', body: 'Pick a domain, a target role and a format, or take the one we recommend from your gaps.' },
  { n: '03', title: 'Interview for 30 to 40 minutes', body: 'A timed session with an adaptive interviewer. Step out whenever you need to.' },
  { n: '04', title: 'Learn what to fix', body: 'A report with evidence, a readiness trend, and the next session worth taking.' },
];

const modes = [
  { group: 'Engineering', items: ['Technical', 'Coding', 'System design', 'Project deep dive', 'Debugging', 'Behavioral'] },
  { group: 'Business', items: ['Case study', 'Strategy', 'Marketing', 'Finance', 'Operations', 'Product'] },
  { group: 'Every domain', items: ['HR round', 'Leadership', 'Communication', 'Quant reasoning', 'Document review', 'Whiteboard'] },
];

export default function Landing() {
  return (
    <div className="relative overflow-x-clip">
      <main id="main">
        <LandingHero />

        <section id="features" aria-labelledby="features-h" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20">
          <p className="eyebrow mb-4">Features</p>
          <h2 id="features-h" className="display max-w-2xl text-3xl md:text-5xl">Everything a real interview asks of you, in one room.</h2>
          <ul className="mt-12 grid gap-4 [perspective:1200px] sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }, i) => (
              <li key={title}>
                <Reveal delay={i * 0.06} className="h-full">
                  <TiltCard className="glass h-full rounded-[var(--radius)] p-6">
                    <span className="mb-5 grid size-10 place-items-center rounded-xl bg-accent-soft [transform:translateZ(30px)]"><Icon className="text-accent" size={19} aria-hidden /></span>
                    <h3 className="text-lg [transform:translateZ(20px)]">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
                  </TiltCard>
                </Reveal>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" aria-labelledby="how-h" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20">
          <p className="eyebrow mb-4">How it works</p>
          <h2 id="how-h" className="display max-w-2xl text-3xl md:text-5xl">From resume to readiness in four steps.</h2>
          <ol className="mt-12 grid gap-px overflow-hidden rounded-[var(--radius)] border border-border bg-border md:grid-cols-4">
            {steps.map((s) => (
              <li key={s.n} className="bg-bg-2/80 p-6 backdrop-blur">
                <p className="font-mono text-sm text-accent-2">{s.n}</p>
                <h3 className="mt-6 text-lg">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="modes" aria-labelledby="modes-h" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20">
          <p className="eyebrow mb-4">Interview modes</p>
          <h2 id="modes-h" className="display max-w-2xl text-3xl md:text-5xl">Built for your field, not just engineering.</h2>
          <p className="mt-4 max-w-xl text-muted">Modes are data, not code. New domains and formats appear without a redesign.</p>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {modes.map((m) => (
              <Reveal key={m.group} className="glass rounded-[var(--radius)] p-6">
                <h3 className="text-lg">{m.group}</h3>
                <ul className="mt-5 flex flex-wrap gap-2">
                  {m.items.map((i) => <li key={i} className="rounded-full border border-border bg-surface-2 px-3 py-1 text-[13px] text-muted">{i}</li>)}
                </ul>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="careers" aria-labelledby="careers-h" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="eyebrow mb-4">Career intelligence</p>
              <h2 id="careers-h" className="display text-3xl md:text-5xl">Roles that fit what you show, not only what you claim.</h2>
              <p className="mt-5 max-w-lg text-muted">Matches combine your resume, your interview performance and your demonstrated skills. We show the evidence, the gaps, and the next interview to take. We never promise an outcome.</p>
              <ButtonLink href="/register" variant="secondary" className="mt-8">See my matches <ArrowRight size={16} aria-hidden /></ButtonLink>
            </div>
            <Reveal className="glass rounded-[var(--radius)] p-6">
              <div className="mb-5 flex items-center gap-2 text-sm text-muted"><Briefcase size={16} aria-hidden /> Example role match</div>
              {[['Data Analyst', 82, 'Strong match'], ['Business Analyst', 64, 'Potential match'], ['Product Manager', 41, 'Requires development']].map(([n, v, l]) => (
                <div key={n as string} className="border-t border-border py-4 first:border-t-0 first:pt-0">
                  <div className="mb-2 flex items-baseline justify-between"><span className="font-medium">{n}</span><span className="text-sm text-muted">{l} · <span className="text-fg">{v}%</span></span></div>
                  <Progress label={`${n} match`} value={v as number} />
                </div>
              ))}
              <p className="mt-2 flex items-center gap-2 text-xs text-muted"><BarChart3 size={13} aria-hidden /> Illustrative. Your matches come from your own sessions.</p>
            </Reveal>
          </div>
        </section>

        <section id="about" aria-labelledby="about-h" className="mx-auto max-w-3xl scroll-mt-24 px-5 py-20 text-center">
          <p className="eyebrow mb-4">About</p>
          <h2 id="about-h" className="display text-3xl md:text-5xl">Honest practice beats flattering practice.</h2>
          <p className="mt-6 text-pretty text-lg text-muted">Rehearse is built for students, graduates and early-career professionals who want to know where they really stand. Scores come from published rubrics and quoted evidence, never from vibes, and the platform says so when it is unsure.</p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/register" size="lg">Start interview <ArrowRight size={18} aria-hidden /></ButtonLink>
            <ButtonLink href="/login" size="lg" variant="secondary">Sign in</ButtonLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-5 py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-sm text-muted">
          <Logo />
          <p>Your resume and answers are private to your account. Delete them any time in Settings.</p>
        </div>
      </footer>
    </div>
  );
}
