'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CareerRoleList,
  CreateResumeResponse,
  DomainList,
  Evaluation,
  HistoryList,
  LanguageList,
  Me,
  ModeDetail,
  ModeList,
  MyAnalytics,
  Profile,
  ReadinessList,
  Recommendations,
  Report,
  Resume,
  Session,
  SessionState,
  Submission,
  SubmissionList,
  SubmissionResult,
  RunJob,
  SubmitTurnResponse,
  Trends,
  type CreateResumeRequest,
  type CreateSessionRequest,
  type CreateSubmissionRequest,
  type PatchProfileRequest,
  type SubmitTurnRequest,
} from '@ai-interview/shared';
import { api, apiPoll, apiVoid, newIdempotencyKey, ApiError } from './client';

const notFoundAsNull = (e: unknown) => {
  if (e instanceof ApiError && e.status === 404) return null;
  throw e;
};

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api('/me', Me) });
export const useDomains = () => useQuery({ queryKey: ['domains'], queryFn: () => api('/domains', DomainList) });
export const useRoles = (domainId?: string) =>
  useQuery({ queryKey: ['roles', domainId], enabled: !!domainId, queryFn: () => api(`/domains/${domainId}/roles`, CareerRoleList) });
export const useModes = (domainId?: string) =>
  useQuery({ queryKey: ['modes', domainId], enabled: !!domainId, queryFn: () => api(`/domains/${domainId}/modes`, ModeList) });
export const useModeDetail = (id?: string) =>
  useQuery({ queryKey: ['mode', id], enabled: !!id, queryFn: () => api(`/modes/${id}`, ModeDetail) });
export const useLanguages = () => useQuery({ queryKey: ['languages'], queryFn: () => api('/languages', LanguageList) });

export const useProfile = () =>
  useQuery({ queryKey: ['profile'], queryFn: () => api('/profile', Profile).catch(notFoundAsNull) });
export const useReadiness = () => useQuery({ queryKey: ['readiness'], queryFn: () => api('/readiness', ReadinessList) });

export const useResume = (id?: string | null) =>
  useQuery({
    queryKey: ['resume', id],
    enabled: !!id,
    queryFn: () => api(`/resumes/${id}`, Resume),
    refetchInterval: (q) => (q.state.data && ['uploaded', 'parsing'].includes(q.state.data.status) ? 1000 : false),
  });

export const useRecommendations = () => useQuery({ queryKey: ['recommendations'], queryFn: () => api('/recommendations', Recommendations) });
export const useHistory = (q: { domain?: string; mode?: string } = {}) =>
  useQuery({ queryKey: ['history', q], queryFn: () => api('/history', HistoryList, { query: q }) });
export const useTrends = (competency?: string) =>
  useQuery({ queryKey: ['trends', competency], queryFn: () => api('/history/trends', Trends, { query: { competency } }) });
export const useMyAnalytics = () => useQuery({ queryKey: ['analytics'], queryFn: () => api('/analytics/me', MyAnalytics) });

export const useSession = (id: string) => useQuery({ queryKey: ['session', id], queryFn: () => api(`/sessions/${id}`, Session) });
export const useSessionState = (id: string) =>
  useQuery({ queryKey: ['session-state', id], queryFn: () => api(`/sessions/${id}/state`, SessionState) });

const pollOnce = (kind: 'evaluation' | 'report', id: string) =>
  kind === 'evaluation' ? apiPoll(`/sessions/${id}/evaluation`, Evaluation) : apiPoll(`/sessions/${id}/report`, Report);

export const useReport = (id: string) =>
  useQuery({
    queryKey: ['report', id],
    queryFn: () => pollOnce('report', id) as Promise<Report | null>,
    refetchInterval: (q) => (q.state.data === null ? 2500 : false),
  });
export const useEvaluation = (id: string) =>
  useQuery({
    queryKey: ['evaluation', id],
    queryFn: () => pollOnce('evaluation', id) as Promise<Evaluation | null>,
    refetchInterval: (q) => (q.state.data === null || q.state.data?.status === 'pending' ? 2500 : false),
  });

export function useCreateSession() {
  return useMutation({
    mutationFn: (b: CreateSessionRequest) =>
      api('/sessions', Session, { method: 'POST', body: b, idempotencyKey: newIdempotencyKey() }),
  });
}

export function useSubmitTurn(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: SubmitTurnRequest) => api(`/sessions/${sessionId}/turns`, SubmitTurnResponse, { method: 'POST', body: b }),
    onSuccess: (r) => qc.setQueryData(['session-state', sessionId], r.state),
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'seq_conflict') qc.invalidateQueries({ queryKey: ['session-state', sessionId] });
    },
  });
}

export function useEndSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/sessions/${sessionId}/end`, Session, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session-state', sessionId] });
      qc.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export function useCreateSubmission(stageRunId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateSubmissionRequest) =>
      api(`/stage-runs/${stageRunId}/submissions`, Submission, { method: 'POST', body: b, idempotencyKey: newIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['submissions', stageRunId] }),
  });
}
export const useSubmissions = (stageRunId: string) =>
  useQuery({ queryKey: ['submissions', stageRunId], queryFn: () => api(`/stage-runs/${stageRunId}/submissions`, SubmissionList) });
export const runSubmission = (id: string) => api(`/submissions/${id}/run`, RunJob, { method: 'POST' });
export const useSubmissionResult = (id: string | null, active: boolean) =>
  useQuery({
    queryKey: ['submission-result', id],
    enabled: !!id && active,
    queryFn: () => api(`/submissions/${id}/result`, SubmissionResult),
    refetchInterval: (q) => {
      const s = q.state.data;
      return s && (s.jobStatus === 'completed' || s.jobStatus === 'failed') ? false : 1500;
    },
  });

export function usePatchProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: PatchProfileRequest) => api('/profile', Profile, { method: 'PATCH', body: b }),
    onSuccess: (p) => qc.setQueryData(['profile'], p),
  });
}

export function useDeleteAccount() {
  return useMutation({ mutationFn: () => apiVoid('/me', { method: 'DELETE' }) });
}

/** Presign, PUT the file straight to storage, then tell the API it is done. */
export function useUploadResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const body: CreateResumeRequest = {
        fileName: file.name,
        contentType: file.type as CreateResumeRequest['contentType'],
        sizeBytes: file.size,
      };
      const created = await api('/resumes', CreateResumeResponse, { method: 'POST', body, idempotencyKey: newIdempotencyKey() });
      const put = await fetch(created.uploadUrl, { method: 'PUT', headers: created.uploadHeaders, body: file });
      if (!put.ok) throw new ApiError(put.status, 'internal', 'Upload failed', 'The file could not be sent to storage.');
      return api(`/resumes/${created.resumeId}/complete`, Resume, { method: 'POST' });
    },
    onSuccess: (r) => {
      qc.setQueryData(['resume', r.id], r);
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
