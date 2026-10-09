import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { AuthForm } from '@/components/auth/auth-form';

export const metadata: Metadata = { title: 'Create account' };

export default function Page() {
  return (
    <AuthShell title="Start practicing" subtitle="Create an account to upload your resume and run your first interview.">
      <AuthForm mode="register" />
    </AuthShell>
  );
}
