import type { ReactNode } from 'react';
import { ArrowRight, Briefcase, Code2, FileText, ListChecks, MessagesSquare, Scale, Target, TrendingUp, Users, Cpu, Handshake } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScoreRing } from '@/components/ui/score-ring';
import { CtaLink } from './cta-button';
import { InterviewPreview } from './landing-preview';
import { Reveal, TiltCard } from './landing-motion';

const wrap = 'mx-auto max-w-6xl scroll-mt-28 px-5 py-14 md:py-20';

function Heading({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <Reveal>
      <p className="eyebrow mb-4 flex items-center gap-2"><span className="h-px w-6 bg-accent" />{eyebrow}</p>
      <h2 id={id} className="display max-w-3xl text-3xl md:text-5xl">{title}</h2>
      {children && <p className="mt-4 max-w-xl text-pretty text-muted md:text-lg">{children}</p>}
    </Reveal>
  );
}

// Spans are chosen so each row of the 3-column grid adds up to 3, which gives a varied, intentional layout.
const features = [
  { icon: FileText, span: 'lg:col-span-2', title: 'Resume-based personalised interviews', body: 'Your projects, roles and skills decide the questions you get and how hard they are. Every question names something from your own resume, so nothing feels generic.' },
  { icon: MessagesSquare, span: '', title: 'Adaptive follow-ups', body: 'One question at a time, with follow-ups that build on what you actually said.' },
  { icon: Code2, span: '', title: 'Coding challenges', body: 'Write and run code in an isolated sandbox. Hidden tests stay hidden, like the real thing.' },
  { icon: Scale, span: 'lg:col-span-2', title: 'Evidence-based evaluation', body: 'Every score links to a published rubric criterion and a quote from your own answer, and the report says when it is unsure.' },
  { icon: ListChecks, span: '', title: 'Actionable feedback', body: 'A short list of what to fix first, and the next session worth taking.' },
  { icon: Target, span: 'lg:col-span-2', title: 'Career intelligence', body: 'See which roles fit what you have shown, where the gaps are, and what to practise next. Never a promise of an outcome.' },
];

export function Features() {
  return (
    <section id="features" aria-labelledby="features-h" className={wrap}>
      <Heading id="features-h" eyebrow="Features" title="Everything a real interview asks of you, in one room." />
      <ul className="mt-12 grid gap-4 [perspective:1200px] sm:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, span, title, body }, i) => (
          <li key={title} className={span}>
            <Reveal delay={i * 0.05} className="h-full">
              <TiltCard className="glass h-full rounded-[var(--radius)] p-6 md:p-7">
                <span className="mb-6 grid size-11 place-items-center rounded-xl bg-accent-soft [transform:translateZ(30px)]"><Icon className="text-accent" size={20} aria-hidden /></span>
                <h3 className="text-lg font-semibold [transform:translateZ(20px)]">{title}</h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{body}</p>
              </TiltCard>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}

const steps = [
  { n: '01', title: 'Upload your resume', body: 'We separate what it states from what we infer, and let you correct either.' },
  { n: '02', title: 'Choose your interview', body: 'Technical, coding, HR or behavioral. We suggest the one your resume points to.' },
  { n: '03', title: 'Take the adaptive interview', body: 'About 35 minutes with an interviewer that follows up on your answers. Leave any time.' },
  { n: '04', title: 'Review score and plan', body: 'A report with evidence, a readiness trend and an improvement plan.' },
];

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-h" className={wrap}>
      <Heading id="how-h" eyebrow="How it works" title="From resume to readiness in four steps." />
      <ol className="relative mt-14 grid gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-6">
        <span aria-hidden className="absolute left-[19px] top-2 hidden h-[calc(100%-1rem)] w-px bg-border max-md:block" />
        <span aria-hidden className="absolute left-5 right-5 top-5 hidden h-px bg-border lg:block" />
        {steps.map((s, i) => (
          <li key={s.n} className="relative max-md:pl-14">
            <Reveal delay={i * 0.08}>
              <span className="absolute left-0 top-0 grid size-10 place-items-center rounded-full border border-accent/50 bg-bg font-mono text-sm text-accent shadow-[0_0_24px_-6px_var(--glow-a)] md:static">{s.n}</span>
              <h3 className="mt-0 text-lg font-semibold md:mt-6">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Preview() {
  return (
    <section id="preview" aria-labelledby="preview-h" className={wrap}>
      <Heading id="preview-h" eyebrow="Inside the room" title="See what a session feels like.">A preview of the interview screen. Type an answer, watch the timer, and open the sample feedback. It is an illustration, so nothing is sent or scored.</Heading>
      <Reveal className="mt-12"><InterviewPreview /></Reveal>
    </section>
  );
}

const modes = [
  { icon: Cpu, title: 'Technical', tone: 'bg-accent text-accent-fg', body: 'Questions on the skills, tools and projects on your resume, rising from fundamentals to design trade-offs.', chips: ['3 stages', '35 min'] },
  { icon: Code2, title: 'Coding', tone: 'bg-accent-2 text-accent-fg', body: 'Solve problems in a live editor against hidden tests, then explain your approach out loud.', chips: ['Live editor', 'Hidden tests'] },
  { icon: Handshake, title: 'Behavioral', tone: 'bg-warm text-accent-fg', body: 'Tell-me-about-a-time questions on teamwork, setbacks and leadership, answered in STAR form.', chips: ['STAR method', '3 rounds'] },
  { icon: Users, title: 'HR and role-specific', tone: 'bg-fg text-bg', body: 'Motivation and fit, plus system design and case formats for specific roles.', chips: ['HR round', 'Case', 'System design'] },
];

export function Modes() {
  return (
    <section id="modes" aria-labelledby="modes-h" className={wrap}>
      <Heading id="modes-h" eyebrow="Interview modes" title="Pick the interview you need.">Each mode is built around your resume. Not sure which? Setup suggests the one that fits your skills and weak spots.</Heading>
      <ul className="mt-12 grid gap-4 [perspective:1200px] sm:grid-cols-2 lg:grid-cols-4">
        {modes.map(({ icon: Icon, title, tone, body, chips }, i) => (
          <li key={title}>
            <Reveal delay={i * 0.06} className="h-full">
              <TiltCard className="glass flex h-full flex-col rounded-[var(--radius)] p-6">
                <span className={`mb-8 grid size-12 place-items-center rounded-2xl ${tone} [transform:translateZ(30px)]`}><Icon size={22} aria-hidden /></span>
                <h3 className="text-xl font-semibold">{title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{body}</p>
                <ul className="mt-6 flex flex-wrap gap-2">
                  {chips.map((c) => <li key={c} className="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-muted">{c}</li>)}
                </ul>
              </TiltCard>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}

const categories = [
  { name: 'Communication', value: 82 },
  { name: 'Problem solving', value: 74 },
  { name: 'Technical depth', value: 69 },
  { name: 'Structure', value: 85 },
];
const fixes = [
  'Quantify each driver before naming a cause. Your strongest answer did, the others did not.',
  'Lead with the answer, then the reasoning. Two replies buried the conclusion at the end.',
  'Practise a system design interview next to close the biggest gap.',
];

export function Results() {
  return (
    <section id="results" aria-labelledby="results-h" className={wrap}>
      <div className="grid items-center gap-12 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <Heading id="results-h" eyebrow="Results and feedback" title="A report you can act on.">Scores by category, evidence from your own answers, and a short plan. The numbers on the right are a sample to show the layout, not real results.</Heading>
          <Reveal delay={0.1}>
            <ButtonLink href="/register" variant="secondary" className="mt-8">See my own results <ArrowRight size={16} aria-hidden /></ButtonLink>
          </Reveal>
        </div>
        <Reveal className="[perspective:1400px]">
          <TiltCard className="glass rounded-[22px] p-5 sm:p-7">
            <div className="mb-6 flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm text-muted"><Briefcase size={15} aria-hidden /> Sample performance report</p>
              <span className="rounded-full border border-border bg-surface-2 px-3 py-1 text-[11px] uppercase tracking-widest text-muted">Sample data</span>
            </div>
            <div className="grid gap-8 sm:grid-cols-[auto_1fr] sm:items-center">
              <div className="mx-auto [transform:translateZ(40px)]"><ScoreRing value={78} label="Sample overall score" caption="Overall" className="size-36" /></div>
              <ul className="space-y-4">
                {categories.map((c) => (
                  <li key={c.name}>
                    <div className="mb-1.5 flex justify-between text-sm"><span>{c.name}</span><span className="tabular-nums text-muted">{c.value}</span></div>
                    <Progress label={`${c.name} (sample)`} value={c.value} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-7 border-t border-border pt-5">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium"><TrendingUp size={15} className="text-accent-2" aria-hidden /> Suggested improvements</p>
              <ul className="space-y-2.5 text-sm leading-relaxed text-muted">
                {fixes.map((f) => <li key={f} className="flex gap-3"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />{f}</li>)}
              </ul>
            </div>
          </TiltCard>
        </Reveal>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section id="start" aria-labelledby="start-h" className="mx-auto max-w-6xl scroll-mt-28 px-5 pb-20 pt-6 md:pb-28">
      <Reveal>
        <div className="relative isolate overflow-hidden rounded-[28px] border border-border bg-surface px-6 py-16 text-center md:px-12 md:py-24">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <div className="drift absolute -left-16 -top-24 size-[420px] rounded-full bg-accent/30 blur-[100px]" />
            <div className="drift absolute -bottom-32 -right-10 size-[380px] rounded-full bg-accent-2/20 blur-[100px] [animation-delay:-8s]" />
          </div>
          <h2 id="start-h" className="display mx-auto max-w-3xl text-4xl md:text-6xl">Your next interview starts <span className="text-accent">here.</span></h2>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-muted md:text-lg">Upload a resume, pick an interview type and get honest feedback in about 35 minutes.</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
            <CtaLink size="lg" />
            <a href="/login" className="inline-flex min-h-11 items-center rounded-full px-4 text-base font-semibold text-muted transition hover:text-fg">I already have an account</a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
