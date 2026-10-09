'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { CardSkeleton, ErrorState } from '@/components/ui/states';

export function Async<T>({
  query,
  skeleton = <CardSkeleton />,
  children,
}: {
  query: UseQueryResult<T>;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{skeleton}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return <>{children(query.data)}</>;
}
