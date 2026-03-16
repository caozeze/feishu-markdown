import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FeishuMarkdown } from '../src/index';
import { BlockType } from '../src/types/feishu';

const mockGetDocument = vi.fn();
const mockListChildren = vi.fn();
const mockDeleteBlock = vi.fn();
const mockDeleteChildBlocks = vi.fn();
const mockCreateDescendantBlocks = vi.fn();
const mockUpdateBlocks = vi.fn();
const mockUploadMedia = vi.fn();
const mockDownloadMedia = vi.fn();
const mockCreateDocument = vi.fn();
const mockTransferOwner = vi.fn();

vi.mock('../src/client/index', () => {
  return {
    FeishuClient: vi.fn().mockImplementation(() => ({
      getDocument: mockGetDocument,
      listChildren: mockListChildren,
      deleteBlock: mockDeleteBlock,
      deleteChildBlocks: mockDeleteChildBlocks,
      createDescendantBlocks: mockCreateDescendantBlocks,
      updateBlocks: mockUpdateBlocks,
      uploadMedia: mockUploadMedia,
      downloadMedia: mockDownloadMedia,
      createDocument: mockCreateDocument,
      transferOwner: mockTransferOwner,
      getDocumentUrl: (documentId: string) => `https://feishu.cn/docx/${documentId}`,
    })),
  };
});

describe('FeishuMarkdown document operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should read document info from a docx URL', async () => {
    mockGetDocument.mockResolvedValue({
      document: {
        document_id: 'doc123',
        revision_id: 12,
        title: 'Doc Title',
      },
    });

    const feishu = new FeishuMarkdown({
      appId: 'appId',
      appSecret: 'appSecret',
    });

    const result = await feishu.getDocumentInfo('https://feishu.cn/docx/doc123');

    expect(mockGetDocument).toHaveBeenCalledWith('doc123');
    expect(result).toEqual({
      documentId: 'doc123',
      url: 'https://feishu.cn/docx/doc123',
      title: 'Doc Title',
      revisionId: 12,
    });
  });

  it('should build a recursive document tree across paginated children', async () => {
    mockListChildren.mockImplementation(
      async (_documentId: string, blockId: string, pageToken?: string) => {
        if (blockId === 'doc123' && !pageToken) {
          return {
            items: [
              {
                block_id: 'heading1',
                block_type: BlockType.Heading1,
                children: [],
                heading1: {
                  elements: [{ text_run: { content: 'Title' } }],
                },
              },
            ],
            has_more: true,
            page_token: 'page-2',
          };
        }

        if (blockId === 'doc123' && pageToken === 'page-2') {
          return {
            items: [
              {
                block_id: 'bullet1',
                block_type: BlockType.Bullet,
                children: ['child-text'],
                bullet: {
                  elements: [{ text_run: { content: 'Item' } }],
                },
              },
            ],
            has_more: false,
          };
        }

        if (blockId === 'bullet1') {
          return {
            items: [
              {
                block_id: 'child-text',
                block_type: BlockType.Text,
                children: [],
                text: {
                  elements: [{ text_run: { content: 'Nested paragraph' } }],
                },
              },
            ],
            has_more: false,
          };
        }

        return {
          items: [],
          has_more: false,
        };
      }
    );

    const feishu = new FeishuMarkdown({
      appId: 'appId',
      appSecret: 'appSecret',
    });

    const result = await feishu.getDocumentBlocks('doc123');

    expect('tree' in result).toBe(true);
    if (!('tree' in result)) {
      throw new Error('Expected recursive tree result');
    }

    expect(result.tree).toHaveLength(2);
    expect(result.tree[0]?.block.block_id).toBe('heading1');
    expect(result.tree[1]?.children[0]?.block.block_id).toBe('child-text');
  });

  it('should return a flat page when recursive mode is disabled', async () => {
    mockListChildren.mockResolvedValue({
      items: [
        {
          block_id: 'text1',
          block_type: BlockType.Text,
          children: [],
          text: {
            elements: [{ text_run: { content: 'Hello' } }],
          },
        },
      ],
      has_more: true,
      page_token: 'next-page',
    });

    const feishu = new FeishuMarkdown({
      appId: 'appId',
      appSecret: 'appSecret',
    });

    const result = await feishu.getDocumentBlocks('doc123', {
      recursive: false,
      pageSize: 100,
    });

    expect(result).toEqual({
      documentId: 'doc123',
      rootBlockId: 'doc123',
      items: [
        expect.objectContaining({
          block_id: 'text1',
        }),
      ],
      hasMore: true,
      pageToken: 'next-page',
    });
    expect(mockListChildren).toHaveBeenCalledWith('doc123', 'doc123', undefined, 100);
  });

  it('should export document content as markdown', async () => {
    mockGetDocument.mockResolvedValue({
      document: {
        document_id: 'doc123',
        revision_id: 5,
        title: 'Export Title',
      },
    });

    mockListChildren.mockImplementation(async (_documentId: string, blockId: string) => {
      if (blockId === 'doc123') {
        return {
          items: [
            {
              block_id: 'heading1',
              block_type: BlockType.Heading1,
              children: [],
              heading1: {
                elements: [{ text_run: { content: 'Title' } }],
              },
            },
            {
              block_id: 'text1',
              block_type: BlockType.Text,
              children: [],
              text: {
                elements: [
                  { text_run: { content: 'Before ' } },
                  { equation: { content: 'a+b' } },
                  { text_run: { content: ' after' } },
                ],
              },
            },
            {
              block_id: 'code1',
              block_type: BlockType.Code,
              children: [],
              code: {
                elements: [{ text_run: { content: 'console.log(1);' } }],
                style: { language: 30 },
              },
            },
          ],
          has_more: false,
        };
      }

      return {
        items: [],
        has_more: false,
      };
    });

    const feishu = new FeishuMarkdown({
      appId: 'appId',
      appSecret: 'appSecret',
    });

    const result = await feishu.exportMarkdown('doc123');

    expect(result.documentId).toBe('doc123');
    expect(result.title).toBe('Export Title');
    expect(result.markdown).toContain('# Title');
    expect(result.markdown).toContain('Before $a+b$ after');
    expect(result.markdown).toContain('```javascript');
  });

  it('should export markdown and image assets to local files', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'feishu-export-test-'));

    try {
      mockGetDocument.mockResolvedValue({
        document: {
          document_id: 'doc123',
          revision_id: 8,
          title: 'Export Title',
        },
      });

      mockListChildren.mockImplementation(
        async (_documentId: string, blockId: string) => {
          if (blockId === 'doc123') {
            return {
              items: [
                {
                  block_id: 'image1',
                  block_type: BlockType.Image,
                  children: [],
                  image: {
                    token: 'img_token_123',
                  },
                },
              ],
              has_more: false,
            };
          }

          return {
            items: [],
            has_more: false,
          };
        }
      );
      mockDownloadMedia.mockResolvedValue({
        buffer: Buffer.from('image'),
        fileName: 'img_token_123.png',
      });

      const feishu = new FeishuMarkdown({
        appId: 'appId',
        appSecret: 'appSecret',
      });

      const filePath = join(outputDir, 'export.md');
      const result = await feishu.exportMarkdownToFile('doc123', filePath);
      const markdown = await readFile(filePath, 'utf8');

      expect(result.filePath).toBe(filePath);
      expect(result.assetFiles).toHaveLength(1);
      expect(result.assetDir).toBe(join(outputDir, 'export_assets'));
      expect(markdown).toContain('![image](./export_assets/img_token_123.png)');
      expect(mockDownloadMedia).toHaveBeenCalledWith('img_token_123');
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('should delete root children until replace is complete', async () => {
    mockListChildren
      .mockResolvedValueOnce({
        items: [
          { block_id: 'block-1', block_type: BlockType.Text, children: [] },
          { block_id: 'block-2', block_type: BlockType.Text, children: [] },
        ],
        has_more: true,
        page_token: 'ignored',
      })
      .mockResolvedValueOnce({
        items: [
          { block_id: 'block-3', block_type: BlockType.Text, children: [] },
        ],
        has_more: false,
      })
      .mockResolvedValueOnce({
        items: [],
        has_more: false,
      });

    mockCreateDescendantBlocks.mockResolvedValue({
      children: [],
      document_revision_id: 9,
      block_id_relations: [],
    });

    const feishu = new FeishuMarkdown({
      appId: 'appId',
      appSecret: 'appSecret',
    });

    await feishu.replace('doc123', 'Replacement content');

    expect(mockDeleteChildBlocks).toHaveBeenCalledTimes(2);
    expect(mockDeleteChildBlocks).toHaveBeenNthCalledWith(1, 'doc123', 'doc123', 0, 2);
    expect(mockDeleteChildBlocks).toHaveBeenNthCalledWith(2, 'doc123', 'doc123', 0, 1);
    expect(mockListChildren).toHaveBeenNthCalledWith(1, 'doc123', 'doc123');
    expect(mockListChildren).toHaveBeenNthCalledWith(2, 'doc123', 'doc123');
    expect(mockListChildren).toHaveBeenNthCalledWith(3, 'doc123', 'doc123');
  });

  it('should respect explicit batchSize when uploading content', async () => {
    mockCreateDescendantBlocks.mockResolvedValue({
      children: [],
      document_revision_id: 3,
      block_id_relations: [],
    });

    const feishu = new FeishuMarkdown({
      appId: 'appId',
      appSecret: 'appSecret',
    });

    await feishu.uploadContent(
      'doc123',
      [
        {
          block_id: 'block-1',
          block_type: BlockType.Text,
          children: [],
          text: { elements: [{ text_run: { content: 'one' } }] },
        },
        {
          block_id: 'block-2',
          block_type: BlockType.Text,
          children: [],
          text: { elements: [{ text_run: { content: 'two' } }] },
        },
        {
          block_id: 'block-3',
          block_type: BlockType.Text,
          children: [],
          text: { elements: [{ text_run: { content: 'three' } }] },
        },
      ],
      new Map(),
      { batchSize: 2 }
    );

    expect(mockCreateDescendantBlocks).toHaveBeenCalledTimes(2);
    const firstRequest = mockCreateDescendantBlocks.mock.calls[0]?.[2];
    const secondRequest = mockCreateDescendantBlocks.mock.calls[1]?.[2];
    expect(firstRequest.descendants).toHaveLength(2);
    expect(secondRequest.descendants).toHaveLength(1);
  });

  it('should split nested blocks without dangling child references', async () => {
    mockCreateDescendantBlocks.mockImplementation(
      async (_documentId: string, _parentBlockId: string, request: { descendants: Array<{ block_id: string }> }) => ({
        children: [],
        document_revision_id: 4,
        block_id_relations: request.descendants.map((block) => ({
          temporary_block_id: block.block_id,
          block_id: `real_${block.block_id}`,
        })),
      })
    );

    const feishu = new FeishuMarkdown({
      appId: 'appId',
      appSecret: 'appSecret',
    });

    await feishu.uploadContent(
      'doc123',
      [
        {
          block_id: 'parent',
          block_type: BlockType.Bullet,
          children: ['child'],
          bullet: { elements: [{ text_run: { content: 'Parent' } }] },
        },
        {
          block_id: 'child',
          block_type: BlockType.Bullet,
          children: ['grandchild'],
          bullet: { elements: [{ text_run: { content: 'Child' } }] },
        },
        {
          block_id: 'grandchild',
          block_type: BlockType.Text,
          children: [],
          text: { elements: [{ text_run: { content: 'Grandchild' } }] },
        },
      ],
      new Map(),
      { batchSize: 2 }
    );

    expect(mockCreateDescendantBlocks).toHaveBeenCalledTimes(2);

    const firstCall = mockCreateDescendantBlocks.mock.calls[0];
    const secondCall = mockCreateDescendantBlocks.mock.calls[1];
    const firstRequest = firstCall?.[2];
    const secondRequest = secondCall?.[2];

    expect(firstCall?.[1]).toBe('doc123');
    expect(firstRequest?.children_id).toEqual(['parent']);
    expect(firstRequest?.descendants).toEqual([
      expect.objectContaining({
        block_id: 'parent',
        children: [],
      }),
    ]);

    expect(secondCall?.[1]).toBe('real_parent');
    expect(secondRequest?.children_id).toEqual(['child']);
    expect(secondRequest?.descendants).toEqual([
      expect.objectContaining({
        block_id: 'child',
        children: ['grandchild'],
      }),
      expect.objectContaining({
        block_id: 'grandchild',
        children: [],
      }),
    ]);
  });

  it('should keep table subtrees atomic when batchSize is smaller than the table size', async () => {
    mockCreateDescendantBlocks.mockResolvedValue({
      children: [],
      document_revision_id: 5,
      block_id_relations: [],
    });

    const feishu = new FeishuMarkdown({
      appId: 'appId',
      appSecret: 'appSecret',
    });

    await feishu.uploadContent(
      'doc123',
      [
        {
          block_id: 'table',
          block_type: BlockType.Table,
          children: ['cell-1', 'cell-2'],
          table: {
            property: {
              row_size: 1,
              column_size: 2,
              column_width: [50, 50],
            },
          },
        },
        {
          block_id: 'cell-1',
          block_type: BlockType.TableCell,
          children: ['text-1'],
          table_cell: {},
        },
        {
          block_id: 'cell-2',
          block_type: BlockType.TableCell,
          children: ['text-2'],
          table_cell: {},
        },
        {
          block_id: 'text-1',
          block_type: BlockType.Text,
          children: [],
          text: { elements: [{ text_run: { content: 'A' } }] },
        },
        {
          block_id: 'text-2',
          block_type: BlockType.Text,
          children: [],
          text: { elements: [{ text_run: { content: 'B' } }] },
        },
      ],
      new Map(),
      { batchSize: 2 }
    );

    expect(mockCreateDescendantBlocks).toHaveBeenCalledTimes(1);
    expect(mockCreateDescendantBlocks).toHaveBeenCalledWith(
      'doc123',
      'doc123',
      expect.objectContaining({
        children_id: ['table'],
        descendants: expect.arrayContaining([
          expect.objectContaining({
            block_id: 'table',
            children: ['cell-1', 'cell-2'],
          }),
          expect.objectContaining({
            block_id: 'cell-1',
            children: ['text-1'],
          }),
          expect.objectContaining({
            block_id: 'cell-2',
            children: ['text-2'],
          }),
        ]),
      })
    );
  });

  it('should restore token-backed image placeholders during upload', async () => {
    mockCreateDescendantBlocks.mockResolvedValue({
      children: [],
      document_revision_id: 6,
      block_id_relations: [
        {
          temporary_block_id: 'image-1',
          block_id: 'real-image-1',
        },
      ],
    });
    mockDownloadMedia.mockResolvedValue({
      buffer: Buffer.from('image'),
      fileName: 'image.png',
    });
    mockUploadMedia.mockResolvedValue('uploaded_file_token');

    const feishu = new FeishuMarkdown({
      appId: 'appId',
      appSecret: 'appSecret',
    });

    await feishu.uploadContent(
      'doc123',
      [
        {
          block_id: 'image-1',
          block_type: BlockType.Image,
          children: [],
          image: {},
        },
      ],
      new Map([
        [
          'image-1',
          {
            source: {
              type: 'token',
              token: 'img_token_123',
            },
          },
        ],
      ]),
      {}
    );

    expect(mockDownloadMedia).toHaveBeenCalledWith('img_token_123');
    expect(mockUploadMedia).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image.png',
      'docx_image',
      'real-image-1',
      5
    );
    expect(mockUpdateBlocks).toHaveBeenCalledWith('doc123', [
      {
        block_id: 'real-image-1',
        replace_image: {
          token: 'uploaded_file_token',
        },
      },
    ]);
  });
});
