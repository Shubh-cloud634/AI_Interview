import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MAX_RESUME_BYTES } from '@ai-interview/shared';
import { createTestApp, type TestApp, type TestUser } from './helpers/app';

let t: TestApp;
let u: TestUser;
beforeAll(async () => {
  t = await createTestApp();
  u = await t.user();
});
afterAll(() => t.close());

const RESUME = `Jane Doe
Senior Software Engineer at Acme Corp, 2019 - 2024
Built Python services and PostgreSQL schemas for payments.
Education: State University, BSc Computer Science`;

async function upload(contentType: string, bytes: string | Uint8Array, declared?: number) {
  const size = declared ?? (typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength);
  const created = await t.call(u, { method: 'POST', url: '/v1/resumes', payload: { fileName: 'cv', contentType, sizeBytes: size } });
  expect(created.statusCode, created.body).toBe(201);
  const [row] = await t.db.query<{ object_key: string }>('select object_key from resumes where id = $1', [created.json.resumeId]);
  t.store.put(row!.object_key, bytes);
  const done = await t.call(u, { method: 'POST', url: `/v1/resumes/${created.json.resumeId}/complete` });
  expect(done.statusCode).toBe(202);
  await t.drain();
  return (await t.call(u, { method: 'GET', url: `/v1/resumes/${created.json.resumeId}` })).json as { status: string; error: string | null };
}

describe('resume upload validation', () => {
  test('upload URL is for an object under the caller\'s prefix, never a client-chosen path', async () => {
    const res = await t.call(u, { method: 'POST', url: '/v1/resumes', payload: { fileName: '../../etc/passwd', contentType: 'text/plain', sizeBytes: 10 } });
    expect(res.statusCode).toBe(201);
    const [row] = await t.db.query<{ object_key: string }>('select object_key from resumes where id = $1', [res.json.resumeId]);
    expect(row!.object_key).toMatch(new RegExp(`^${u.id}/[0-9a-f-]{36}$`));
  });

  test.each([
    ['an executable type', { contentType: 'application/x-msdownload', sizeBytes: 10 }],
    ['html', { contentType: 'text/html', sizeBytes: 10 }],
    ['zero bytes', { contentType: 'text/plain', sizeBytes: 0 }],
    ['over the size limit', { contentType: 'application/pdf', sizeBytes: MAX_RESUME_BYTES + 1 }],
  ])('rejects %s at create time', async (_n, body) => {
    const res = await t.call(u, { method: 'POST', url: '/v1/resumes', payload: { fileName: 'cv', ...body } });
    expect(res.statusCode).toBe(400);
    expect(res.json.code).toBe('validation_failed');
  });

  test('a text resume parses into a profile', async () => {
    t.ai.queue('extractProfile', {
      headline: 'Senior Software Engineer', summary: null,
      experiences: [{ org: 'Acme Corp', title: 'Senior Software Engineer', start: '2019', end: '2024', description: null }],
      education: [{ institution: 'State University', degree: 'BSc', field: 'Computer Science', start: null, end: null }],
      skills: [{ name: 'Python', level: 4, span: 'Built Python services' }],
    });
    expect((await upload('text/plain', RESUME)).status).toBe('parsed');
    const p = (await t.call(u, { method: 'GET', url: '/v1/profile' })).json;
    expect(p.experiences).toEqual([expect.objectContaining({ org: 'Acme Corp' })]);
    expect(p.skills).toEqual([expect.objectContaining({ name: 'Python', skillId: expect.any(String), evidence: ['Built Python services'] })]);
  });

  test.each([
    ['text bytes declared as PDF', 'application/pdf', RESUME],
    ['PDF bytes declared as DOCX', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '%PDF-1.7 fake'],
    ['binary declared as plain text', 'text/plain', new Uint8Array([0x4d, 0x5a, 0x00, 0x00, 0x90])],
  ])('a spoofed content type fails: %s', async (_n, type, bytes) => {
    const r = await upload(type, bytes);
    expect(r.status).toBe('failed');
    expect(r.error).toBe('file content does not match its declared type');
  });

  test('an object larger than its declared size fails without being parsed', async () => {
    const calls = t.ai.callsOf('extractProfile').length;
    const r = await upload('text/plain', RESUME + ' '.repeat(5000), 200);
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/size limit/);
    expect(t.ai.callsOf('extractProfile').length).toBe(calls);
  });

  test('complete without an upload fails cleanly', async () => {
    const created = await t.call(u, { method: 'POST', url: '/v1/resumes', payload: { fileName: 'cv', contentType: 'text/plain', sizeBytes: 50 } });
    await t.call(u, { method: 'POST', url: `/v1/resumes/${created.json.resumeId}/complete` });
    await t.drain();
    const r = (await t.call(u, { method: 'GET', url: `/v1/resumes/${created.json.resumeId}` })).json;
    expect(r).toMatchObject({ status: 'failed', error: 'file was not uploaded' });
  });

  test('a retried complete is a no-op and enqueues one parse', async () => {
    const created = await t.call(u, { method: 'POST', url: '/v1/resumes', payload: { fileName: 'cv', contentType: 'text/plain', sizeBytes: 50 } });
    for (let i = 0; i < 3; i++) await t.call(u, { method: 'POST', url: `/v1/resumes/${created.json.resumeId}/complete` });
    const jobs = await t.db.query(`select 1 from jobs where name = 'parse_resume' and payload->>'resumeId' = $1`, [created.json.resumeId]);
    expect(jobs).toHaveLength(1);
  });
});
