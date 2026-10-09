import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { AuthForm } from '@/components/auth/auth-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function Page() {
  return (
    <AuthShell title="Welcome back" subtitle="Pick up where your last practice session ended.">
      <AuthForm mode="login" />
    </AuthShell>
  );
}
