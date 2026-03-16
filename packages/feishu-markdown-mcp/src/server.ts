import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  APIError,
  normalizeDocumentId,
} from 'feishu-markdown';
import type { FeishuMarkdown, FeishuMarkdownOptions } from 'feishu-markdown';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export interface ToolServer {
  registerTool(
    name: string,
    definition: {
      description: string;
      inputSchema: Record<string, z.ZodTypeAny>;
    },
    handler: (args: Record<string, unknown>) => Promise<CallToolResult>
  ): void;
}

export interface RegisterToolsOptions {
  getFeishuMarkdown: () => FeishuMarkdown;
  setConfig: (config: FeishuMarkdownOptions) => void;
}

const SetConfigSchema = z.object({
  appId: z.string(),
  appSecret: z.string(),
  feishuMobile: z.string().optional(),
});

const MermaidOptionsSchema = z.object({
  enabled: z.boolean().optional(),
  theme: z.enum(['default', 'forest', 'dark', 'neutral']).optional(),
  backgroundColor: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const ConvertOptionsSchema = z.object({
  title: z.string().optional(),
  folderToken: z.string().optional(),
  imageBaseDir: z
    .string()
    .optional()
    .describe('Local image base directory for relative Markdown images'),
  downloadImages: z.boolean().optional(),
  mermaid: MermaidOptionsSchema.optional(),
  batchSize: z.number().optional(),
  mermaidTempDir: z.string().optional(),
});

const UploadFileSchema = z.object({
  filePath: z.string().describe('Absolute path to the Markdown file'),
  ...ConvertOptionsSchema.shape,
});

const UploadTextSchema = z.object({
  text: z.string(),
  ...ConvertOptionsSchema.shape,
});

const UpdateDocSchema = z.object({
  url: z.string().describe('Feishu docx URL or document ID'),
  markdown: z.string(),
  mode: z.enum(['append', 'replace']).describe('Update mode'),
  ...ConvertOptionsSchema.shape,
});

const GetDocumentSchema = z.object({
  document: z.string().describe('Document ID or docx URL'),
});

const ExportMarkdownToFileSchema = z.object({
  document: z.string().describe('Document ID or docx URL'),
  filePath: z.string().describe('Absolute or relative path to write the Markdown file'),
  assetDirName: z
    .string()
    .optional()
    .describe('Optional asset directory name created next to the Markdown file'),
});

const GetDocumentBlocksSchema = z.object({
  document: z.string().describe('Document ID or docx URL'),
  blockId: z.string().optional(),
  recursive: z.boolean().optional(),
  pageSize: z.number().optional(),
});

export function registerFeishuMarkdownTools(
  server: ToolServer,
  options: RegisterToolsOptions
): void {
  server.registerTool(
    'set_config',
    {
      description: 'Configure Feishu application credentials',
      inputSchema: SetConfigSchema.shape,
    },
    async ({ appId, appSecret, feishuMobile }) => {
      return callTool(async () => {
        options.setConfig({
          appId: appId as string,
          appSecret: appSecret as string,
          feishuMobile: feishuMobile as string | undefined,
        });

        return { message: 'Configuration saved' };
      });
    }
  );

  server.registerTool(
    'upload_markdown_file',
    {
      description: 'Upload a local Markdown file to Feishu',
      inputSchema: UploadFileSchema.shape,
    },
    async ({ filePath, ...rawOptions }) => {
      return callTool(async () => {
        const markdown = await fs.readFile(filePath as string, 'utf-8');
        const feishu = options.getFeishuMarkdown();
        const imageBaseDir =
          (rawOptions.imageBaseDir as string | undefined) ??
          path.dirname(filePath as string);

        return feishu.convert(markdown, {
          ...rawOptions,
          imageBaseDir,
          title:
            (rawOptions.title as string | undefined) ??
            path.basename(filePath as string),
        });
      });
    }
  );

  server.registerTool(
    'upload_markdown_text',
    {
      description: 'Upload Markdown text to Feishu',
      inputSchema: UploadTextSchema.shape,
    },
    async ({ text, ...rawOptions }) => {
      return callTool(async () => {
        const feishu = options.getFeishuMarkdown();
        return feishu.convert(text as string, {
          ...rawOptions,
          title: (rawOptions.title as string | undefined) ?? 'Untitled',
        });
      });
    }
  );

  server.registerTool(
    'update_feishu_document',
    {
      description: 'Append to or replace an existing Feishu document',
      inputSchema: UpdateDocSchema.shape,
    },
    async ({ url, markdown, mode, ...rawOptions }) => {
      return callTool(async () => {
        const documentId = normalizeDocumentId(url as string);
        const feishu = options.getFeishuMarkdown();

        return mode === 'replace'
          ? feishu.replace(documentId, markdown as string, rawOptions)
          : feishu.append(documentId, markdown as string, rawOptions);
      });
    }
  );

  server.registerTool(
    'get_document_info',
    {
      description: 'Read Feishu document metadata',
      inputSchema: GetDocumentSchema.shape,
    },
    async ({ document }) => {
      return callTool(async () => {
        return options.getFeishuMarkdown().getDocumentInfo(document as string);
      });
    }
  );

  server.registerTool(
    'get_document_blocks',
    {
      description: 'Read Feishu document blocks as a tree or a flat page',
      inputSchema: GetDocumentBlocksSchema.shape,
    },
    async ({ document, blockId, recursive, pageSize }) => {
      return callTool(async () => {
        return options.getFeishuMarkdown().getDocumentBlocks(
          document as string,
          {
            blockId: blockId as string | undefined,
            recursive: (recursive as boolean | undefined) ?? true,
            pageSize: pageSize as number | undefined,
          }
        );
      });
    }
  );

  server.registerTool(
    'export_markdown',
    {
      description: 'Export a Feishu document to Markdown',
      inputSchema: GetDocumentSchema.shape,
    },
    async ({ document }) => {
      return callTool(async () => {
        return options.getFeishuMarkdown().exportMarkdown(document as string);
      });
    }
  );

  server.registerTool(
    'export_markdown_to_file',
    {
      description:
        'Export a Feishu document to a local Markdown file and download images into a local assets directory',
      inputSchema: ExportMarkdownToFileSchema.shape,
    },
    async ({ document, filePath, assetDirName }) => {
      return callTool(async () => {
        return options.getFeishuMarkdown().exportMarkdownToFile(
          document as string,
          filePath as string,
          {
            assetDirName: assetDirName as string | undefined,
          }
        );
      });
    }
  );
}

async function callTool<T>(fn: () => PromiseLike<T>): Promise<CallToolResult> {
  try {
    const result = await fn();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const result = {
      error: error instanceof Error ? error.name : 'UnknownError',
      message: `uncaught error: ${
        error instanceof Error ? error.message : String(error)
      }`,
      fullMessage: error instanceof APIError ? error.fullMessage : undefined,
      stack: error instanceof Error ? error.stack : undefined,
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
}
