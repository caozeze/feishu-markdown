import { describe, expect, it } from 'vitest';

import { exportDocumentTreeToMarkdown } from '@/exporter/index';
import type { DocumentBlockNode } from '@/types/document';
import { BlockType, CodeLanguage } from '@/types/feishu';

describe('exportDocumentTreeToMarkdown', () => {
  it('should export tables, block equations, quotes, images, and unsupported blocks', () => {
    const tree: DocumentBlockNode[] = [
      {
        block: {
          block_id: 'math1',
          block_type: BlockType.Text,
          children: [],
          text: {
            elements: [{ equation: { content: '\\frac{a}{b}' } }],
          },
        },
        children: [],
      },
      {
        block: {
          block_id: 'quote1',
          block_type: BlockType.QuoteContainer,
          children: ['quote-text'],
          quote_container: {},
        },
        children: [
          {
            block: {
              block_id: 'quote-text',
              block_type: BlockType.Text,
              children: [],
              text: {
                elements: [{ text_run: { content: 'Quoted text' } }],
              },
            },
            children: [],
          },
        ],
      },
      {
        block: {
          block_id: 'table1',
          block_type: BlockType.Table,
          children: ['cell-1', 'cell-2'],
          table: {
            property: {
              row_size: 1,
              column_size: 2,
            },
          },
        },
        children: [
          {
            block: {
              block_id: 'cell-1',
              block_type: BlockType.TableCell,
              children: ['cell-1-text'],
              table_cell: {},
            },
            children: [
              {
                block: {
                  block_id: 'cell-1-text',
                  block_type: BlockType.Text,
                  children: [],
                  text: {
                    elements: [{ text_run: { content: 'A' } }],
                  },
                },
                children: [],
              },
            ],
          },
          {
            block: {
              block_id: 'cell-2',
              block_type: BlockType.TableCell,
              children: ['cell-2-text'],
              table_cell: {},
            },
            children: [
              {
                block: {
                  block_id: 'cell-2-text',
                  block_type: BlockType.Text,
                  children: [],
                  text: {
                    elements: [{ text_run: { content: 'B' } }],
                  },
                },
                children: [],
              },
            ],
          },
        ],
      },
      {
        block: {
          block_id: 'image1',
          block_type: BlockType.Image,
          children: [],
          image: { token: 'img-token' },
        },
        children: [],
      },
      {
        block: {
          block_id: 'code1',
          block_type: BlockType.Code,
          children: [],
          code: {
            elements: [{ text_run: { content: 'const x = 1;' } }],
            style: {
              language: CodeLanguage.TypeScript,
            },
          },
        },
        children: [],
      },
      {
        block: {
          block_id: 'unknown1',
          block_type: BlockType.Board,
          children: [],
        },
        children: [],
      },
    ];

    const markdown = exportDocumentTreeToMarkdown(tree);

    expect(markdown).toContain('$$\n\\frac{a}{b}\n$$');
    expect(markdown).toContain('> Quoted text');
    expect(markdown).toContain('| A | B |');
    expect(markdown).toContain('<!-- feishu-image token: img-token -->');
    expect(markdown).toContain('```typescript');
    expect(markdown).toContain('<!-- unsupported feishu block type: 43 -->');
  });
});
