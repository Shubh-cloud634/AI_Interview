'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Async } from '@/components/async';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';
import { ThemeToggle } from '@/components/theme-toggle';
import { useDeleteAccount, useMe } from '@/lib/api/hooks';
import { supabase } from '@/lib/supabase';

export default function Settings() {
  const me = useMe();
  const del = useDeleteAccount();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    try {
      await del.mutateAsync();
    } catch {
      return;
    }
    await supabase().auth.signOut().catch(() => undefined);
    router.replace('/');
  }

  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-5">
        <Card>
          <CardTitle className="mb-4">Account</CardTitle>
          <Async query={me}>
            {(m) => (
              <dl className="grid gap-2 text-sm sm:grid-cols-[120px_1fr]">
                <dt className="text-muted">Name</dt><dd>{m.displayName ?? 'Not set'}</dd>
                <dt className="text-muted">Email</dt><dd>{m.email ?? 'Not set'}</dd>
                <dt className="text-muted">Roles</dt><dd className="capitalize">{m.roles.join(', ').replace(/_/g, ' ')}</dd>
              </dl>
            )}
          </Async>
        </Card>
        <Card className="flex items-center justify-between"><CardTitle>Appearance</CardTitle><ThemeToggle /></Card>
        <Card className="border-bad/40">
          <CardTitle className="mb-2">Delete my data</CardTitle>
          <p className="mb-4 text-sm text-muted">Permanently deletes your account, resume, profile, sessions and reports. This cannot be undone.</p>
          {!confirming ? (
            <Button variant="danger" onClick={() => setConfirming(true)}>Delete account</Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="danger" disabled={del.isPending} onClick={remove}>{del.isPending ? 'Deleting…' : 'Yes, delete everything'}</Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
            </div>
          )}
          {del.isError && <div className="mt-4"><ErrorState error={del.error} /></div>}
        </Card>
        <Button variant="secondary" onClick={() => supabase().auth.signOut()}>Sign out</Button>
      </div>
    </>
  );
}
