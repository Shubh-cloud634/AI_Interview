import type { ComponentType } from 'react';
import type { StageKind } from '@ai-interview/shared';
import { CodingPane } from './coding-pane';
import { TextPane } from './text-pane';
import type { PaneProps } from './types';

/** Keyed on interaction kind only. A new career domain never touches this table. */
export const panes: Record<StageKind, ComponentType<PaneProps>> = {
  conversation: TextPane,
  coding: CodingPane,
  case: TextPane,
  quant: TextPane,
  document: TextPane,
  whiteboard: TextPane,
};
