import type { Root } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { gfm } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';

import { ParseError } from '@/errors';

/**
 * 解析 Markdown 文本为 AST
 */
export function parseMarkdown(markdown: string): Root {
  try {
    return fromMarkdown(markdown, {
      extensions: [gfm(), math()],
      mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
    });
  } catch (error) {
    throw new ParseError(
      'Failed to parse markdown',
      error instanceof Error ? error : undefined
    );
  }
}
