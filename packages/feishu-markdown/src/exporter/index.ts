import type { DocumentBlockNode } from '@/types/document';
import type { FeishuBlock, TextBlockData, TextElement } from '@/types/feishu';
import { BlockType, CodeLanguage } from '@/types/feishu';

const TEXT_BLOCK_KEYS: Partial<Record<BlockType, keyof FeishuBlock>> = {
  [BlockType.Text]: 'text',
  [BlockType.Heading1]: 'heading1',
  [BlockType.Heading2]: 'heading2',
  [BlockType.Heading3]: 'heading3',
  [BlockType.Heading4]: 'heading4',
  [BlockType.Heading5]: 'heading5',
  [BlockType.Heading6]: 'heading6',
  [BlockType.Heading7]: 'heading7',
  [BlockType.Heading8]: 'heading8',
  [BlockType.Heading9]: 'heading9',
  [BlockType.Bullet]: 'bullet',
  [BlockType.Ordered]: 'ordered',
  [BlockType.Code]: 'code',
  [BlockType.Quote]: 'quote',
  [BlockType.Todo]: 'todo',
};

interface ExportRenderOptions {
  imagePathsByToken?: Map<string, string>;
}

export function exportDocumentTreeToMarkdown(
  tree: DocumentBlockNode[],
  options: ExportRenderOptions = {}
): string {
  return renderNodes(tree, options).trim();
}

function renderNodes(
  nodes: DocumentBlockNode[],
  options: ExportRenderOptions
): string {
  const rendered: string[] = [];
  let previousWasList = false;

  for (const node of nodes) {
    const markdown = renderNode(node, options);
    if (!markdown) {
      continue;
    }

    const currentIsList = isListBlock(node.block.block_type);
    if (rendered.length > 0) {
      rendered.push(previousWasList && currentIsList ? '\n' : '\n\n');
    }

    rendered.push(markdown);
    previousWasList = currentIsList;
  }

  return rendered.join('');
}

function renderNode(
  node: DocumentBlockNode,
  options: ExportRenderOptions,
  indent = ''
): string {
  switch (node.block.block_type) {
    case BlockType.Text:
      return renderTextBlock(node.block, indent);
    case BlockType.Heading1:
    case BlockType.Heading2:
    case BlockType.Heading3:
    case BlockType.Heading4:
    case BlockType.Heading5:
    case BlockType.Heading6:
    case BlockType.Heading7:
    case BlockType.Heading8:
    case BlockType.Heading9:
      return renderHeadingBlock(node.block, indent);
    case BlockType.Bullet:
    case BlockType.Ordered:
    case BlockType.Todo:
      return renderListItem(node, options, indent);
    case BlockType.Code:
      return renderCodeBlock(node.block, indent);
    case BlockType.QuoteContainer:
      return renderQuoteContainer(node, options, indent);
    case BlockType.Quote:
      return renderQuoteBlock(node.block, indent);
    case BlockType.Divider:
      return applyIndent('---', indent);
    case BlockType.Table:
      return renderTable(node, options, indent);
    case BlockType.Image:
      return renderImage(node.block, options, indent);
    default:
      return renderUnsupported(node.block, indent);
  }
}

function renderTextBlock(block: FeishuBlock, indent = ''): string {
  const elements = getTextElements(block);
  if (elements.length === 1 && elements[0]?.equation) {
    return applyIndent(`$$\n${elements[0].equation.content}\n$$`, indent);
  }

  const text = renderTextElements(elements);
  return applyIndent(text || '', indent);
}

function renderHeadingBlock(block: FeishuBlock, indent = ''): string {
  const elements = getTextElements(block);
  const text = renderTextElements(elements);
  const level = Math.min(mapHeadingLevel(block.block_type), 6);
  const marker = '#'.repeat(level);
  return applyIndent(`${marker} ${text}`.trimEnd(), indent);
}

function renderListItem(
  node: DocumentBlockNode,
  options: ExportRenderOptions,
  indent = ''
): string {
  const marker = getListMarker(node.block);
  const text = renderTextElements(getTextElements(node.block));
  const line = text ? `${indent}${marker} ${text}` : `${indent}${marker}`;
  const childIndent = `${indent}    `;
  const children = node.children
    .map((child) => renderNode(child, options, childIndent))
    .filter((child) => child.trim().length > 0);

  return [line, ...children].join('\n');
}

function renderCodeBlock(block: FeishuBlock, indent = ''): string {
  const data = getTextBlockData(block);
  const code = data?.elements?.[0]?.text_run?.content ?? '';
  const language = mapCodeLanguageToFence(data?.style?.language);
  const fence = language ? `\`\`\`${language}` : '```';
  return applyIndent(`${fence}\n${code}\n\`\`\``, indent);
}

function renderQuoteContainer(
  node: DocumentBlockNode,
  options: ExportRenderOptions,
  indent = ''
): string {
  const inner = renderNodes(node.children, options);
  return applyIndent(prefixQuotedBlock(inner), indent);
}

function renderQuoteBlock(block: FeishuBlock, indent = ''): string {
  const inner = renderTextElements(getTextElements(block));
  return applyIndent(prefixQuotedBlock(inner), indent);
}

function renderTable(
  node: DocumentBlockNode,
  options: ExportRenderOptions,
  indent = ''
): string {
  const rowSize = node.block.table?.property.row_size ?? 0;
  const columnSize = node.block.table?.property.column_size ?? 0;

  if (rowSize <= 0 || columnSize <= 0) {
    return renderUnsupported(node.block, indent);
  }

  const rows: string[][] = [];
  let cellIndex = 0;

  for (let row = 0; row < rowSize; row++) {
    const cells: string[] = [];

    for (let column = 0; column < columnSize; column++) {
      const cell = node.children[cellIndex++];
      cells.push(cell ? renderTableCell(cell, options) : '');
    }

    rows.push(cells);
  }

  const header = rows[0] ?? new Array<string>(columnSize).fill('');
  const body = rows.slice(1);
  const separator = new Array<string>(columnSize).fill('---');
  const lines = [
    renderTableRow(header),
    renderTableRow(separator),
    ...body.map(renderTableRow),
  ];

  return applyIndent(lines.join('\n'), indent);
}

function renderTableCell(
  node: DocumentBlockNode,
  options: ExportRenderOptions
): string {
  const rendered = renderNodes(node.children, options);
  return rendered
    .trim()
    .replace(/\n{2,}/g, '<br>')
    .replace(/\n/g, '<br>')
    .replace(/\|/g, '\\|');
}

function renderTableRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function renderImage(
  block: FeishuBlock,
  options: ExportRenderOptions,
  indent = ''
): string {
  const url =
    ((block.image as { url?: string } | undefined)?.url ??
      (block as { image_url?: string }).image_url) ??
    undefined;

  if (url) {
    return applyIndent(`![image](${url})`, indent);
  }

  const token = block.image?.token;
  const localPath =
    (token ? options.imagePathsByToken?.get(token) : undefined) ?? undefined;
  if (localPath) {
    return applyIndent(`![image](${localPath})`, indent);
  }

  const comment = token
    ? `<!-- feishu-image token: ${token} -->`
    : '<!-- feishu-image -->';
  return applyIndent(comment, indent);
}

function renderUnsupported(block: FeishuBlock, indent = ''): string {
  return applyIndent(
    `<!-- unsupported feishu block type: ${block.block_type} -->`,
    indent
  );
}

function renderTextElements(
  elements: TextElement[],
  options: { inTable?: boolean } = {}
): string {
  return elements.map((element) => renderTextElement(element, options)).join('');
}

function renderTextElement(
  element: TextElement,
  options: { inTable?: boolean } = {}
): string {
  if (element.text_run) {
    const style = element.text_run.text_element_style;
    const text = escapeMarkdownText(element.text_run.content, options);

    if (element.text_run.content === '\n') {
      return options.inTable ? '<br>' : '  \n';
    }

    if (style?.inline_code) {
      const codeText = `\`${text.replace(/`/g, '\\`')}\``;
      return style.link ? `[${codeText}](${style.link.url})` : codeText;
    }

    let result = text;
    if (style?.strikethrough) {
      result = `~~${result}~~`;
    }
    if (style?.bold) {
      result = `**${result}**`;
    }
    if (style?.italic) {
      result = `*${result}*`;
    }
    if (style?.link) {
      result = `[${result || style.link.url}](${style.link.url})`;
    }
    return result;
  }

  if (element.equation) {
    return `$${element.equation.content}$`;
  }

  if (element.mention_doc) {
    return `[document](${element.mention_doc.url})`;
  }

  if (element.mention_user) {
    return '@user';
  }

  return '';
}

function escapeMarkdownText(
  value: string,
  options: { inTable?: boolean } = {}
): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/([*_`[\]])/g, '\\$1')
    .replace(/\n/g, options.inTable ? '<br>' : '  \n');

  return options.inTable ? escaped.replace(/\|/g, '\\|') : escaped;
}

function getTextBlockData(block: FeishuBlock): TextBlockData | undefined {
  const key = TEXT_BLOCK_KEYS[block.block_type];
  if (!key) {
    return undefined;
  }

  return block[key] as TextBlockData | undefined;
}

function getTextElements(block: FeishuBlock): TextElement[] {
  return getTextBlockData(block)?.elements ?? [];
}

function mapHeadingLevel(blockType: BlockType): number {
  switch (blockType) {
    case BlockType.Heading1:
      return 1;
    case BlockType.Heading2:
      return 2;
    case BlockType.Heading3:
      return 3;
    case BlockType.Heading4:
      return 4;
    case BlockType.Heading5:
      return 5;
    case BlockType.Heading6:
      return 6;
    case BlockType.Heading7:
      return 7;
    case BlockType.Heading8:
      return 8;
    case BlockType.Heading9:
      return 9;
    default:
      return 6;
  }
}

function mapCodeLanguageToFence(language?: CodeLanguage): string {
  if (!language || language === CodeLanguage.PlainText) {
    return '';
  }

  const explicitMap: Partial<Record<CodeLanguage, string>> = {
    [CodeLanguage.Bash]: 'bash',
    [CodeLanguage.C]: 'c',
    [CodeLanguage.CPlusPlus]: 'cpp',
    [CodeLanguage.CSharp]: 'csharp',
    [CodeLanguage.Go]: 'go',
    [CodeLanguage.HTML]: 'html',
    [CodeLanguage.Java]: 'java',
    [CodeLanguage.JavaScript]: 'javascript',
    [CodeLanguage.JSON]: 'json',
    [CodeLanguage.LaTeX]: 'latex',
    [CodeLanguage.Markdown]: 'markdown',
    [CodeLanguage.PowerShell]: 'powershell',
    [CodeLanguage.Python]: 'python',
    [CodeLanguage.Rust]: 'rust',
    [CodeLanguage.SQL]: 'sql',
    [CodeLanguage.Swift]: 'swift',
    [CodeLanguage.TypeScript]: 'typescript',
    [CodeLanguage.XML]: 'xml',
    [CodeLanguage.YAML]: 'yaml',
  };

  const mapped = explicitMap[language];
  if (mapped) {
    return mapped;
  }

  const enumName = CodeLanguage[language];
  return typeof enumName === 'string' ? enumName.toLowerCase() : '';
}

function getListMarker(block: FeishuBlock): string {
  switch (block.block_type) {
    case BlockType.Ordered:
      return '1.';
    case BlockType.Todo:
      return block.todo?.style?.done ? '- [x]' : '- [ ]';
    default:
      return '-';
  }
}

function isListBlock(blockType: BlockType): boolean {
  return (
    blockType === BlockType.Bullet ||
    blockType === BlockType.Ordered ||
    blockType === BlockType.Todo
  );
}

function prefixQuotedBlock(content: string): string {
  return content
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n');
}

function applyIndent(content: string, indent: string): string {
  if (!indent) {
    return content;
  }

  return content
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');
}
