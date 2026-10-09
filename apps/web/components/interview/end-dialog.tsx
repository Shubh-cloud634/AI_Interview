'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

/** Accessible replacement for window.confirm: native <dialog> gives focus trapping and Escape for free. */
export function EndDialog({ open, busy, onCancel, onConfirm }: { open: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      aria-labelledby="end-title"
      className="glass m-auto w-[min(92vw,26rem)] rounded-3xl p-0 text-fg backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="p-7">
        <h2 id="end-title" className="text-xl">End this interview?</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Your answers so far are saved and scored. Stages you have not answered will not be scored, and you cannot resume this session.
        </p>
        <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} autoFocus>Keep going</Button>
          <Button variant="danger" disabled={busy} onClick={onConfirm}>{busy ? 'Ending…' : 'End interview'}</Button>
        </div>
      </div>
    </dialog>
  );
}
