import type { ResumeContentType } from '@ai-interview/shared';

/** Text extraction port (PDF, DOCX, plain text). OCR fallback is not implemented. */
export type Extractor = (bytes: Uint8Array, contentType: ResumeContentType) => Promise<string>;

const MAX_TEXT_CHARS = 60_000;

/** Declared type must match the file's magic bytes. */
export function sniffMatches(bytes: Uint8Array, contentType: ResumeContentType): boolean {
  const head = Buffer.from(bytes.subarray(0, 4)).toString('latin1');
  if (contentType === 'application/pdf') return head === '%PDF';
  if (contentType === 'text/plain') return !bytes.subarray(0, 4096).includes(0);
  return head === 'PK\u0003\u0004';
}

export const extractText: Extractor = async (bytes, contentType) => {
  let text: string;
  if (contentType === 'application/pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    text = (await pdfText(pdf, { mergePages: true })).text;
  } else if (contentType === 'text/plain') {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } else {
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  }
  return text.replace(/\u0000/g, '').slice(0, MAX_TEXT_CHARS);
};
