import { describe, expect, it, vi } from 'vitest';

import { registerFeishuMarkdownTools } from '../src/server';

function createFakeServer() {
  const tools = new Map<
    string,
    {
      definition: { description: string; inputSchema: Record<string, unknown> };
      handler: (args: Record<string, unknown>) => Promise<{
        content: { type: string; text: string }[];
      }>;
    }
  >();

  return {
    tools,
    registerTool(
      name: string,
      definition: { description: string; inputSchema: Record<string, unknown> },
      handler: (args: Record<string, unknown>) => Promise<{
        content: { type: string; text: string }[];
      }>
    ) {
      tools.set(name, { definition, handler });
    },
  };
}

describe('registerFeishuMarkdownTools', () => {
  it('should register read and write tools', () => {
    const server = createFakeServer();

    registerFeishuMarkdownTools(server, {
      getFeishuMarkdown: () => ({}) as never,
      setConfig: vi.fn(),
    });

    expect(server.tools.has('set_config')).toBe(true);
    expect(server.tools.has('upload_markdown_file')).toBe(true);
    expect(server.tools.has('upload_markdown_text')).toBe(true);
    expect(server.tools.has('update_feishu_document')).toBe(true);
    expect(server.tools.has('get_document_info')).toBe(true);
    expect(server.tools.has('get_document_blocks')).toBe(true);
    expect(server.tools.has('export_markdown')).toBe(true);
    expect(server.tools.has('export_markdown_to_file')).toBe(true);
  });

  it('should call getDocumentInfo for get_document_info', async () => {
    const server = createFakeServer();
    const getDocumentInfo = vi.fn().mockResolvedValue({
      documentId: 'doc123',
      title: 'Doc',
      revisionId: 3,
      url: 'https://feishu.cn/docx/doc123',
    });

    registerFeishuMarkdownTools(server, {
      getFeishuMarkdown: () =>
        ({
          getDocumentInfo,
        }) as never,
      setConfig: vi.fn(),
    });

    const tool = server.tools.get('get_document_info');
    if (!tool) {
      throw new Error('get_document_info tool not registered');
    }

    const result = await tool.handler({ document: 'doc123' });

    expect(getDocumentInfo).toHaveBeenCalledWith('doc123');
    expect(result.content[0]?.text).toContain('"documentId": "doc123"');
  });

  it('should default get_document_blocks to recursive mode', async () => {
    const server = createFakeServer();
    const getDocumentBlocks = vi.fn().mockResolvedValue({
      documentId: 'doc123',
      rootBlockId: 'doc123',
      tree: [],
    });

    registerFeishuMarkdownTools(server, {
      getFeishuMarkdown: () =>
        ({
          getDocumentBlocks,
        }) as never,
      setConfig: vi.fn(),
    });

    const tool = server.tools.get('get_document_blocks');
    if (!tool) {
      throw new Error('get_document_blocks tool not registered');
    }

    await tool.handler({ document: 'doc123' });

    expect(getDocumentBlocks).toHaveBeenCalledWith('doc123', {
      blockId: undefined,
      recursive: true,
      pageSize: undefined,
    });
  });

  it('should export markdown through the core library', async () => {
    const server = createFakeServer();
    const exportMarkdown = vi.fn().mockResolvedValue({
      documentId: 'doc123',
      title: 'Doc',
      revisionId: 1,
      markdown: '# Title',
    });

    registerFeishuMarkdownTools(server, {
      getFeishuMarkdown: () =>
        ({
          exportMarkdown,
        }) as never,
      setConfig: vi.fn(),
    });

    const tool = server.tools.get('export_markdown');
    if (!tool) {
      throw new Error('export_markdown tool not registered');
    }

    const result = await tool.handler({ document: 'https://feishu.cn/docx/doc123' });

    expect(exportMarkdown).toHaveBeenCalledWith(
      'https://feishu.cn/docx/doc123'
    );
    expect(result.content[0]?.text).toContain('"markdown": "# Title"');
  });

  it('should export markdown and assets to a local file through the core library', async () => {
    const server = createFakeServer();
    const exportMarkdownToFile = vi.fn().mockResolvedValue({
      documentId: 'doc123',
      title: 'Doc',
      revisionId: 2,
      markdown: '# Title',
      filePath: 'out.md',
      assetDir: 'out_assets',
      assetFiles: ['out_assets/img.png'],
    });

    registerFeishuMarkdownTools(server, {
      getFeishuMarkdown: () =>
        ({
          exportMarkdownToFile,
        }) as never,
      setConfig: vi.fn(),
    });

    const tool = server.tools.get('export_markdown_to_file');
    if (!tool) {
      throw new Error('export_markdown_to_file tool not registered');
    }

    const result = await tool.handler({
      document: 'doc123',
      filePath: 'out.md',
      assetDirName: 'out_assets',
    });

    expect(exportMarkdownToFile).toHaveBeenCalledWith('doc123', 'out.md', {
      assetDirName: 'out_assets',
    });
    expect(result.content[0]?.text).toContain('"assetDir": "out_assets"');
  });

  it('should reject wiki URLs in update_feishu_document', async () => {
    const server = createFakeServer();

    registerFeishuMarkdownTools(server, {
      getFeishuMarkdown: () =>
        ({
          replace: vi.fn(),
          append: vi.fn(),
        }) as never,
      setConfig: vi.fn(),
    });

    const tool = server.tools.get('update_feishu_document');
    if (!tool) {
      throw new Error('update_feishu_document tool not registered');
    }

    const result = await tool.handler({
      url: 'https://feishu.cn/wiki/wiki123',
      markdown: 'content',
      mode: 'replace',
    });

    expect(result.content[0]?.text).toContain('Wiki URLs are not supported yet');
  });
});
