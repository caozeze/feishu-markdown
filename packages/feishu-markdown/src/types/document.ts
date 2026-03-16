import type { FeishuBlock } from './feishu';

export interface DocumentInfoResult {
  documentId: string;
  url: string;
  title: string;
  revisionId: number;
}

export interface DocumentBlockNode {
  block: FeishuBlock;
  children: DocumentBlockNode[];
}

export interface GetDocumentBlocksOptions {
  blockId?: string;
  recursive?: boolean;
  pageSize?: number;
}

export interface RecursiveDocumentBlocksResult {
  documentId: string;
  rootBlockId: string;
  tree: DocumentBlockNode[];
}

export interface FlatDocumentBlocksResult {
  documentId: string;
  rootBlockId: string;
  items: FeishuBlock[];
  hasMore: boolean;
  pageToken?: string;
}

export type GetDocumentBlocksResult =
  | RecursiveDocumentBlocksResult
  | FlatDocumentBlocksResult;

export interface ExportMarkdownResult {
  documentId: string;
  title: string;
  revisionId: number;
  markdown: string;
}

export interface ExportMarkdownToFileOptions {
  assetDirName?: string;
}

export interface ExportMarkdownToFileResult extends ExportMarkdownResult {
  filePath: string;
  assetDir?: string;
  assetFiles: string[];
}
