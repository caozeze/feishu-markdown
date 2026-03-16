import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative } from 'node:path';

import { FeishuClient } from '@/client/index';
import { ConfigError, TransformError } from '@/errors';
import { exportDocumentTreeToMarkdown } from '@/exporter/index';
import type { ImageReference, PreparedImage } from '@/handlers';
import { loadImage } from '@/handlers';
import { parseMarkdown } from '@/parser';
import { transformMarkdownToBlocks } from '@/transformer';
import type {
  DocumentBlockNode,
  DocumentInfoResult,
  ExportMarkdownResult,
  ExportMarkdownToFileOptions,
  ExportMarkdownToFileResult,
  GetDocumentBlocksOptions,
  GetDocumentBlocksResult,
} from '@/types/document';
import type {
  BatchUpdateBlockRequest,
  DescendantBlock,
  FeishuBlock,
} from '@/types/feishu';
import { BlockType } from '@/types/feishu';
import type {
  ConvertOptions,
  ConvertResult,
  FeishuMarkdownOptions,
} from '@/types/options';
import { normalizeDocumentId } from '@/utils';

interface UploadContentBatch {
  parentBlockId: string;
  childrenIds: string[];
  descendants: DescendantBlock[];
}

/**
 * Markdown 转飞书文档主类
 */
export class FeishuMarkdown {
  private readonly client: FeishuClient;
  private readonly defaultOptions: Partial<ConvertOptions>;

  constructor(options: FeishuMarkdownOptions) {
    if (!options.appId || !options.appSecret) {
      throw new ConfigError('appId and appSecret are required');
    }

    this.client = new FeishuClient(options);
    this.defaultOptions = {};
  }

  /**
   * 读取文档元信息
   */
  async getDocumentInfo(documentIdOrUrl: string): Promise<DocumentInfoResult> {
    const documentId = normalizeDocumentId(documentIdOrUrl);
    const { document } = await this.client.getDocument(documentId);

    return {
      documentId,
      url: this.client.getDocumentUrl(documentId),
      title: document.title,
      revisionId: document.revision_id,
    };
  }

  /**
   * 读取文档块结构
   */
  async getDocumentBlocks(
    documentIdOrUrl: string,
    options: GetDocumentBlocksOptions = {}
  ): Promise<GetDocumentBlocksResult> {
    const documentId = normalizeDocumentId(documentIdOrUrl);
    const rootBlockId = options.blockId ?? documentId;
    const pageSize = this.getPageSize(options.pageSize);

    if (options.recursive === false) {
      const data = await this.client.listChildren(
        documentId,
        rootBlockId,
        undefined,
        pageSize
      );

      return {
        documentId,
        rootBlockId,
        items: data.items,
        hasMore: data.has_more,
        pageToken: data.page_token,
      };
    }

    const tree = await this.buildDocumentTree(documentId, rootBlockId, pageSize);

    return {
      documentId,
      rootBlockId,
      tree,
    };
  }

  /**
   * 导出文档为 Markdown
   */
  async exportMarkdown(
    documentIdOrUrl: string
  ): Promise<ExportMarkdownResult> {
    const info = await this.getDocumentInfo(documentIdOrUrl);
    const tree = await this.buildDocumentTree(info.documentId, info.documentId);

    return {
      documentId: info.documentId,
      title: info.title,
      revisionId: info.revisionId,
      markdown: exportDocumentTreeToMarkdown(tree),
    };
  }

  /**
   * 导出文档到本地 Markdown 文件，并将图片落地到 assets 目录
   */
  async exportMarkdownToFile(
    documentIdOrUrl: string,
    filePath: string,
    options: ExportMarkdownToFileOptions = {}
  ): Promise<ExportMarkdownToFileResult> {
    const info = await this.getDocumentInfo(documentIdOrUrl);
    const tree = await this.buildDocumentTree(info.documentId, info.documentId);
    const outputDir = dirname(filePath);
    const assetDirName =
      options.assetDirName ??
      `${basename(filePath, extname(filePath))}_assets`;
    const assetDirPath = join(outputDir, assetDirName);
    const imagePathsByToken = new Map<string, string>();
    const assetFiles: string[] = [];

    await mkdir(outputDir, { recursive: true });

    const imageTokens = this.collectImageTokens(tree);
    if (imageTokens.length > 0) {
      await mkdir(assetDirPath, { recursive: true });

      for (const token of imageTokens) {
        const image = await this.client.downloadMedia(token);
        if (!image.buffer) {
          throw new TransformError(
            `Downloaded image ${token} did not return binary content`
          );
        }
        const assetFilePath = join(assetDirPath, image.fileName);
        await writeFile(assetFilePath, image.buffer);
        assetFiles.push(assetFilePath);
        imagePathsByToken.set(
          token,
          this.toMarkdownRelativePath(relative(outputDir, assetFilePath))
        );
      }
    }

    const markdown = exportDocumentTreeToMarkdown(tree, {
      imagePathsByToken,
    });

    await writeFile(filePath, markdown, 'utf8');

    return {
      documentId: info.documentId,
      title: info.title,
      revisionId: info.revisionId,
      markdown,
      filePath,
      assetDir: assetFiles.length > 0 ? assetDirPath : undefined,
      assetFiles,
    };
  }

  /**
   * 将 Markdown 转换并上传到飞书文档
   */
  async convert(
    markdown: string,
    options: ConvertOptions = {}
  ): Promise<ConvertResult> {
    const {
      options: mergedOptions,
      tempDirCreated,
    } = await this.prepareOptions(options);

    try {
      const ast = parseMarkdown(markdown);
      const { blocks, imageBuffers } = await transformMarkdownToBlocks(
        ast,
        mergedOptions
      );

      if (blocks.length === 0) {
        throw new TransformError('No content to convert');
      }

      const createDocRequest: { folder_token?: string; title?: string } = {};
      if (mergedOptions.folderToken) {
        createDocRequest.folder_token = mergedOptions.folderToken;
      }
      if (mergedOptions.title) {
        createDocRequest.title = mergedOptions.title;
      }
      const { document } = await this.client.createDocument(createDocRequest);

      const documentId = document.document_id;
      if (!documentId) {
        throw new TransformError(
          'Failed to create document: no document_id returned'
        );
      }

      const revisionId = await this.uploadContent(
        documentId,
        blocks,
        imageBuffers,
        mergedOptions,
        document.revision_id
      );

      await this.client.transferOwner(documentId);

      return {
        documentId,
        url: this.client.getDocumentUrl(documentId),
        revisionId,
      };
    } finally {
      await this.cleanupMermaidTempDir(
        tempDirCreated,
        mergedOptions.mermaidTempDir
      );
    }
  }

  /**
   * 追加 Markdown 内容到文档末尾
   */
  async append(
    documentId: string,
    markdown: string,
    options: ConvertOptions = {}
  ): Promise<ConvertResult> {
    const {
      options: mergedOptions,
      tempDirCreated,
    } = await this.prepareOptions(options);

    try {
      const ast = parseMarkdown(markdown);
      const { blocks, imageBuffers } = await transformMarkdownToBlocks(
        ast,
        mergedOptions
      );

      if (blocks.length === 0) {
        return {
          documentId,
          url: this.client.getDocumentUrl(documentId),
          revisionId: 0,
        };
      }

      const revisionId = await this.uploadContent(
        documentId,
        blocks,
        imageBuffers,
        mergedOptions
      );

      return {
        documentId,
        url: this.client.getDocumentUrl(documentId),
        revisionId,
      };
    } finally {
      await this.cleanupMermaidTempDir(
        tempDirCreated,
        mergedOptions.mermaidTempDir
      );
    }
  }

  /**
   * 替换文档内容为 Markdown
   */
  async replace(
    documentId: string,
    markdown: string,
    options: ConvertOptions = {}
  ): Promise<ConvertResult> {
    while (true) {
      const data = await this.client.listChildren(documentId, documentId);
      if (data.items.length === 0) {
        break;
      }

      await this.client.deleteChildBlocks(
        documentId,
        documentId,
        0,
        data.items.length
      );
    }

    return this.append(documentId, markdown, options);
  }

  /**
   * 上传内容（创建块、处理图片）
   * @returns 最新的文档修订版本 ID
   */
  async uploadContent(
    documentId: string,
    blocks: DescendantBlock[],
    imageBuffers: Map<string, ImageReference>,
    options: ConvertOptions,
    initialRevisionId = 0
  ): Promise<number> {
    await this.processImages(blocks, imageBuffers, options);

    const idMapping = new Map<string, string>();
    const maxDescendants = this.getBatchSize(options.batchSize);
    const blockMap = new Map(blocks.map((block) => [block.block_id, block]));
    const blockChildren = new Set(blocks.flatMap(({ children }) => children));
    const rootBlockIds = blocks
      .filter((block) => !blockChildren.has(block.block_id))
      .map((block) => block.block_id);
    const sizeCache = new Map<string, number>();
    const batches = this.planUploadBatches(
      documentId,
      rootBlockIds,
      blockMap,
      maxDescendants,
      sizeCache
    );

    let lastRevisionId = initialRevisionId;

    for (const batch of batches) {
      const parentBlockId =
        idMapping.get(batch.parentBlockId) ?? batch.parentBlockId;
      const { document_revision_id, block_id_relations } =
        await this.client.createDescendantBlocks(
          documentId,
          parentBlockId,
          {
            children_id: batch.childrenIds,
            descendants: batch.descendants,
          }
        );

      lastRevisionId = document_revision_id;

      for (const { temporary_block_id, block_id } of block_id_relations) {
        idMapping.set(temporary_block_id, block_id);
      }
    }

    const updateRequests: BatchUpdateBlockRequest[] = [];

    for (const block of blocks) {
      if (block.block_type !== BlockType.Image) {
        continue;
      }

      const realBlockId = idMapping.get(block.block_id);
      if (!realBlockId) {
        console.warn(
          `Could not find real ID for image block ${block.block_id}`
        );
        continue;
      }

      const prepared = imageBuffers.get(block.block_id);
      if (!prepared) {
        continue;
      }

      const { fileName, source } = prepared;
      let fileToken: string;

      try {
        if (source.type === 'buffer') {
          fileToken = await this.client.uploadMedia(
            source.buffer,
            fileName ?? 'image.png',
            'docx_image',
            realBlockId,
            source.buffer.length
          );
        } else if (source.type === 'path') {
          fileToken = await this.client.uploadMedia(
            source.path,
            fileName ?? basename(source.path) ?? 'image.png',
            'docx_image',
            realBlockId
          );
        } else {
          continue;
        }

        updateRequests.push({
          block_id: realBlockId,
          replace_image: { token: fileToken },
        });
      } catch (error) {
        console.error(
          `Failed to upload media for block ${realBlockId}:`,
          error
        );
      }
    }

    if (updateRequests.length > 0) {
      await this.client.updateBlocks(documentId, updateRequests);
    }

    return lastRevisionId;
  }

  /**
   * 仅解析 Markdown 并返回飞书块结构（不上传）
   */
  async parse(
    markdown: string,
    options: ConvertOptions = {}
  ): Promise<DescendantBlock[]> {
    const ast = parseMarkdown(markdown);
    const { blocks } = await transformMarkdownToBlocks(ast, options);
    return blocks;
  }

  private planUploadBatches(
    parentBlockId: string,
    rootBlockIds: string[],
    blockMap: Map<string, DescendantBlock>,
    max: number,
    sizeCache = new Map<string, number>()
  ): UploadContentBatch[] {
    const batches: UploadContentBatch[] = [];
    let pendingRootIds: string[] = [];
    let pendingDescendants: DescendantBlock[] = [];
    let pendingCount = 0;

    const flushPending = () => {
      if (pendingRootIds.length === 0) {
        return;
      }

      batches.push({
        parentBlockId,
        childrenIds: pendingRootIds,
        descendants: pendingDescendants,
      });

      pendingRootIds = [];
      pendingDescendants = [];
      pendingCount = 0;
    };

    for (const rootBlockId of rootBlockIds) {
      const rootBlock = blockMap.get(rootBlockId);
      if (!rootBlock) {
        continue;
      }

      const subtreeSize = this.getSubtreeSize(rootBlockId, blockMap, sizeCache);
      const isAtomicSubtree = this.isAtomicUploadSubtree(rootBlock);

      if (subtreeSize > max && !isAtomicSubtree) {
        flushPending();

        batches.push({
          parentBlockId,
          childrenIds: [rootBlockId],
          descendants: [this.cloneDescendantBlock(rootBlock, [])],
        });

        if (rootBlock.children.length > 0) {
          batches.push(
            ...this.planUploadBatches(
              rootBlockId,
              rootBlock.children,
              blockMap,
              max,
              sizeCache
            )
          );
        }

        continue;
      }

      if (subtreeSize > max) {
        flushPending();
        batches.push({
          parentBlockId,
          childrenIds: [rootBlockId],
          descendants: this.collectSubtree(rootBlockId, blockMap),
        });
        continue;
      }

      if (pendingCount > 0 && pendingCount + subtreeSize > max) {
        flushPending();
      }

      pendingRootIds.push(rootBlockId);
      pendingDescendants.push(...this.collectSubtree(rootBlockId, blockMap));
      pendingCount += subtreeSize;
    }

    flushPending();

    return batches;
  }

  private collectSubtree(
    rootBlockId: string,
    blockMap: Map<string, DescendantBlock>
  ): DescendantBlock[] {
    const block = blockMap.get(rootBlockId);
    if (!block) {
      return [];
    }

    return [
      this.cloneDescendantBlock(block),
      ...block.children.flatMap((childId) => this.collectSubtree(childId, blockMap)),
    ];
  }

  private getSubtreeSize(
    rootBlockId: string,
    blockMap: Map<string, DescendantBlock>,
    cache = new Map<string, number>()
  ): number {
    const cached = cache.get(rootBlockId);
    if (cached !== undefined) {
      return cached;
    }

    const block = blockMap.get(rootBlockId);
    if (!block) {
      return 0;
    }

    const size =
      1 +
      block.children.reduce(
        (sum, childId) => sum + this.getSubtreeSize(childId, blockMap, cache),
        0
      );

    cache.set(rootBlockId, size);
    return size;
  }

  private cloneDescendantBlock(
    block: DescendantBlock,
    children = block.children
  ): DescendantBlock {
    return {
      ...block,
      children: [...children],
    };
  }

  private isAtomicUploadSubtree(block: DescendantBlock): boolean {
    return block.block_type === BlockType.Table;
  }

  private collectImageTokens(tree: DocumentBlockNode[]): string[] {
    const tokens = new Set<string>();
    const stack = [...tree];

    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }

      const token = node.block.image?.token;
      if (token) {
        tokens.add(token);
      }

      stack.push(...node.children);
    }

    return [...tokens];
  }

  private toMarkdownRelativePath(filePath: string): string {
    const normalized = filePath.split('\\').join('/');
    return normalized.startsWith('.') ? normalized : `./${normalized}`;
  }

  private async buildDocumentTree(
    documentId: string,
    rootBlockId: string,
    pageSize = 500
  ): Promise<DocumentBlockNode[]> {
    const children = await this.listAllChildren(documentId, rootBlockId, pageSize);

    return Promise.all(
      children.map(async (child) => {
        const childBlockId = child.block_id;
        const nestedChildren =
          childBlockId && child.children && child.children.length > 0
            ? await this.buildDocumentTree(documentId, childBlockId, pageSize)
            : [];

        return {
          block: child,
          children: nestedChildren,
        };
      })
    );
  }

  private async listAllChildren(
    documentId: string,
    blockId: string,
    pageSize: number
  ): Promise<FeishuBlock[]> {
    const items: FeishuBlock[] = [];
    let pageToken: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const data = await this.client.listChildren(
        documentId,
        blockId,
        pageToken,
        pageSize
      );

      items.push(...data.items);
      pageToken = data.page_token;
      hasMore = data.has_more;
    }

    return items;
  }

  private async prepareOptions(
    options: ConvertOptions
  ): Promise<{ options: ConvertOptions; tempDirCreated: boolean }> {
    const mergedOptions: ConvertOptions = {
      ...this.defaultOptions,
      ...options,
      mermaid: {
        ...this.defaultOptions.mermaid,
        ...options.mermaid,
      },
    };

    if (!mergedOptions.mermaidTempDir) {
      mergedOptions.mermaidTempDir = await mkdtemp(
        join(tmpdir(), 'feishu-markdown-')
      );
      return {
        options: mergedOptions,
        tempDirCreated: true,
      };
    }

    return {
      options: mergedOptions,
      tempDirCreated: false,
    };
  }

  private async cleanupMermaidTempDir(
    tempDirCreated: boolean,
    mermaidTempDir?: string
  ): Promise<void> {
    if (!tempDirCreated || !mermaidTempDir) {
      return;
    }

    try {
      await rm(mermaidTempDir, {
        recursive: true,
        force: true,
      });
    } catch {
      // ignore
    }
  }

  private getBatchSize(batchSize?: number): number {
    if (typeof batchSize !== 'number' || !Number.isFinite(batchSize)) {
      return 1000;
    }

    return Math.min(Math.max(Math.floor(batchSize), 1), 1000);
  }

  private getPageSize(pageSize?: number): number {
    if (typeof pageSize !== 'number' || !Number.isFinite(pageSize)) {
      return 500;
    }

    return Math.min(Math.max(Math.floor(pageSize), 1), 500);
  }

  /**
   * 处理图片：下载和上传
   */
  private async processImages(
    blocks: DescendantBlock[],
    imageBuffers: Map<string, ImageReference>,
    options: ConvertOptions
  ): Promise<void> {
    for (const [blockId, data] of imageBuffers) {
      const block = blocks.find((item) => item.block_id === blockId);
      if (block?.block_type !== BlockType.Image) {
        continue;
      }

      try {
        let imageData: PreparedImage;
        const downloadEnabled = options.downloadImages !== false;

        if (data.source.type === 'token') {
          imageData = await this.client.downloadMedia(data.source.token);
        } else if (data.source.type === 'buffer') {
          imageData = {
            buffer: data.source.buffer,
            fileName: data.source.fileName ?? data.fileName ?? 'image.png',
          };
        } else {
          imageData = await loadImage(data.source, downloadEnabled);
        }

        if (imageData.buffer) {
          imageBuffers.set(blockId, {
            source: {
              type: 'buffer',
              buffer: imageData.buffer,
              fileName: imageData.fileName,
            },
            fileName: imageData.fileName,
          });
        } else if (imageData.path) {
          imageBuffers.set(blockId, {
            source: {
              type: 'path',
              path: imageData.path,
            },
            fileName: imageData.fileName,
          });
        }
      } catch (error) {
        console.warn(`Failed to process image for block ${blockId}:`, error);
        imageBuffers.delete(blockId);
      }
    }
  }
}
