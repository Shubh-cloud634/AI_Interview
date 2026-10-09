import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory holding `<name>.v<N>.md` prompt templates. Loaded once by the API's AI gateway. */
export const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'templates');
