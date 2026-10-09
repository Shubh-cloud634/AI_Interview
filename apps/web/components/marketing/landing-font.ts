import { Archivo } from 'next/font/google';

/** Heavy grotesque for the hero headline and big numbers. Falls back to the app display font. */
export const archivo = Archivo({ subsets: ['latin'], weight: ['800', '900'], variable: '--font-archivo', display: 'swap' });
