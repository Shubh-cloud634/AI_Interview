'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { authConfigured, supabase } from '@/lib/supabase';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const register = mode === 'register';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email'));
    const password = String(f.get('password'));
    setBusy(true);
    setError(null);
    try {
      const auth = supabase().auth;
      if (register) {
        const { data, error } = await auth.signUp({ email, password, options: { data: { display_name: String(f.get('name') ?? '') } } });
        if (error) throw error;
        if (!data.session) return setNotice('Check your email to confirm your account, then sign in.');
      } else {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    try {
      const { error } = await supabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/dashboard` } });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  if (!authConfigured()) {
    return (
      <p role="alert" className="rounded-xl border border-border bg-surface p-4 text-sm">
        Authentication is not configured. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code>apps/web/.env.local</code>.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate={false}>
      {register && (
        <Field label="Name">
          <Input name="name" autoComplete="name" required />
        </Field>
      )}
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={8} required />
      </Field>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {notice && <p role="status" className="text-sm text-good">{notice}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" size={16} aria-hidden />}
        {register ? 'Create account' : 'Sign in'}
      </Button>
      <Button type="button" variant="secondary" className="w-full" onClick={google}>
        Continue with Google
      </Button>
      <p className="text-center text-sm text-muted">
        {register ? 'Already have an account? ' : 'New here? '}
        <Link className="text-accent underline-offset-4 hover:underline" href={register ? '/login' : '/register'}>
          {register ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </form>
  );
}
