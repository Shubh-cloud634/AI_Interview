# API contract

All schemas are exported from `@ai-interview/shared` (zod 4; each schema has a same-named inferred type).
Base path `/v1`. JSON everywhere. Auth is `Authorization: Bearer <Supabase access token>` on every route except `GET /health`.

Consuming from `apps/web`: add `"@ai-interview/shared": "file:../../packages/shared"` and `transpilePackages: ['@ai-interview/shared']` in `next.config`. The package ships TypeScript source; there is no build step.

## Conventions

- Errors: every non-2xx body is `Problem` (`application/problem+json`, RFC 7807) with a machine `code` (`ErrorCode`). Validation errors carry `errors[{path, message}]`. A `seq_conflict` carries `expectedSeq`.
- Retryable creates take an `Idempotency-Key` header (any string up to 200 chars). Same key and same body returns the stored response; same key with a different body is `409 conflict`.
- Turns are idempotent on `seq`. Read `SessionState.nextSeq`, send it, and resend the same `{seq, content}` on retry.
- `202` with `Pending` (`{status: "pending"}`) means "not ready yet, poll again".
- Rate limits: global per user; stricter on AI-backed routes (session create, turns) and on code runs. Exceeding gives `429 rate_limited` with `retry-after`.
- Domain is only a filter (history). No endpoint switches behavior on a domain.

## Endpoints

| Method | Path | Request | Response | Auth |
|---|---|---|---|---|
| GET | /health | - | `{ok: true}` | none |
| GET | /v1/me | - | `Me` | user |
| DELETE | /v1/me | - | 204 | user |
| GET | /v1/domains | - | `DomainList` | user |
| GET | /v1/domains/{id}/roles | `IdParams` | `CareerRoleList` | user |
| GET | /v1/domains/{id}/modes | `IdParams` | `ModeList` | user |
| GET | /v1/modes/{id} | `IdParams` | `ModeDetail` (latest published version) | user |
| GET | /v1/languages | - | `LanguageList` (addition: needed for `languageId`) | user |
| POST | /v1/packs | `CreatePackRequest` + Idempotency-Key | 201 `Pack` | pack_author |
| POST | /v1/packs/{id}/versions | `CreatePackVersionRequest` | 201 `PackVersion` | pack_author |
| POST | /v1/pack-versions/{id}/publish | - | `PackVersion` | pack_author |
| POST | /v1/resumes | `CreateResumeRequest` + Idempotency-Key | 201 `CreateResumeResponse` (PUT the file to `uploadUrl` with `uploadHeaders`) | user |
| POST | /v1/resumes/{id}/complete | - | 202 `Resume` (parse enqueued) | owner |
| GET | /v1/resumes/{id} | - | `Resume` | owner |
| GET | /v1/profile | - | `Profile` (404 until a resume is parsed or a PATCH creates it) | user |
| PATCH | /v1/profile | `PatchProfileRequest` | `Profile` | user |
| GET | /v1/readiness | - | `ReadinessList` | user |
| POST | /v1/sessions | `CreateSessionRequest` + Idempotency-Key | 201 `Session` (first question already asked) | user |
| GET | /v1/sessions/{id} | - | `Session` | owner |
| GET | /v1/sessions/{id}/state | - | `SessionState` | owner |
| POST | /v1/sessions/{id}/turns | `SubmitTurnRequest` | `SubmitTurnResponse` | owner |
| GET | /v1/sessions/{id}/events | header `Last-Event-ID` or `?lastEventId=` | SSE stream of `SseEvent` | owner |
| POST | /v1/sessions/{id}/end | - | `Session` (status `abandoned` unless already completed) | owner |
| POST | /v1/stage-runs/{id}/submissions | `CreateSubmissionRequest` + Idempotency-Key | 201 `Submission` | owner |
| POST | /v1/submissions/{id}/run | - | 202 `RunJob` (visible tests only) | owner |
| GET | /v1/submissions/{id}/result | - | `SubmissionResult` (poll) | owner |
| GET | /v1/sessions/{id}/evaluation | - | `Evaluation` or 202 `Pending` | owner |
| GET | /v1/sessions/{id}/report | - | `Report` or 202 `Pending` | owner |
| GET | /v1/recommendations | - | `Recommendations` | user |
| GET | /v1/roles/{id}/fit | `IdParams` | `RoleFit` | user |
| GET | /v1/history | `HistoryQuery` (query string) | `HistoryList` | user |
| GET | /v1/history/trends | `TrendsQuery` | `Trends` | user |
| GET | /v1/analytics/me | - | `MyAnalytics` | user |
| GET | /v1/analytics/packs/{id}/questions | `IdParams` | `QuestionStatsList` | admin |

`owner` means the row must belong to the caller; another user's id returns `404 not_found` (not 403, to avoid confirming existence).

Auth endpoints (`/auth/*`) are Supabase's own; the web app talks to Supabase Auth directly.

## Interview room flow

1. `POST /sessions` returns `Session`. Then `GET /sessions/{id}/state` gives `currentStage.kind`, the `question` and `nextSeq`.
2. Mount the pane for `currentStage.kind`. Allowed answer shapes per kind are in `KIND_CONTENT`.
3. Open `GET /sessions/{id}/events`. `token` events stream the next interviewer turn; `question` events carry the final turn (`id:` = seq); `stage_change` precedes the first question of a new stage; `done` closes the stream.
4. `POST /sessions/{id}/turns {seq: nextSeq, content}`. Response has the next interviewer turn and the new state.
5. Coding stage: `POST /stage-runs/{stageRunId}/submissions`, optionally `POST /submissions/{id}/run` and poll `/result`; then submit a turn `{type: "code", submissionId}` to finish the stage.
6. After `done`, poll `/sessions/{id}/report` until 200.

## Enums

`SessionStatus`, `StageKind`, `StageRunStatus`, `TurnActor`, `ResumeStatus`, `EvaluationStatus`, `RunJobStatus`, `RunStatus`, `RunSuite`, `UserRole`, `RecommendationType`, `ReadinessStream`, `ResumeContentType`, `ErrorCode`.
