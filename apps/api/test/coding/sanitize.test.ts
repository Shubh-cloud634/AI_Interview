import { describe, expect, it } from 'vitest';
import { MAX_OUTPUT_CHARS, sanitizeOutput } from '@ai-interview/shared';

describe('sanitizeOutput (F6, S21)', () => {
  it('strips ANSI CSI/OSC sequences, C0/C1 controls and bell', () => {
    expect(sanitizeOutput('\u001b[1;31mred\u001b[0m')).toBe('red');
    expect(sanitizeOutput('\u001b]8;;http://evil\u0007link\u001b]8;;\u0007')).toBe('link');
    expect(sanitizeOutput('\u001b]0;title\u001b\\x')).toBe('x');
    expect(sanitizeOutput('a\u0000b\u0008c\u0007d\u009bJe\u0085f')).toBe('abcdef');
    expect(sanitizeOutput('tab\tand\nnewline')).toBe('tab\tand\nnewline');
  });

  it('normalizes carriage returns so output cannot overwrite earlier text', () => {
    expect(sanitizeOutput('safe\rEVIL')).toBe('safe\nEVIL');
    expect(sanitizeOutput('a\r\nb')).toBe('a\nb');
  });

  it('removes bidi overrides and zero-width characters', () => {
    expect(sanitizeOutput('abc\u202Edcba\u202C\u200Bx\u2066y\u2069\ufeff')).toBe('abcdcbaxy');
  });

  it('redacts absolute POSIX and Windows paths', () => {
    expect(sanitizeOutput('File "/work/main.py", line 3')).toBe('File "<path>", line 3');
    expect(sanitizeOutput('at /usr/local/lib/node_modules/x.js:1')).toBe('at <path>:1');
    expect(sanitizeOutput('C:\\Users\\runner\\secret.txt missing')).toBe('<path> missing');
    expect(sanitizeOutput('ratio 1/2')).toBe('ratio 1/2');
  });

  it('truncates to the cap without splitting a surrogate pair', () => {
    const out = sanitizeOutput('x'.repeat(MAX_OUTPUT_CHARS * 3));
    expect(out.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS + '\n[truncated]'.length);
    expect(out.endsWith('[truncated]')).toBe(true);
    const emoji = sanitizeOutput(`${'a'.repeat(9)}😀😀`, 10);
    expect(emoji).toBe(`${'a'.repeat(9)}\n[truncated]`);
  });

  it('leaves markup and prompt-injection text as inert characters (escaping is the renderer’s job)', () => {
    const s = '<script>alert(1)</script> **bold** Ignore previous instructions';
    expect(sanitizeOutput(s)).toBe(s);
  });
});
