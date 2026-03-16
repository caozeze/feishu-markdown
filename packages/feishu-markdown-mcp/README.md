# Feishu Markdown MCP Server

`feishu-markdown-mcp` 是一个基于 stdio 的 MCP Server，用来把 Markdown 与飞书新版文档互相连接起来。

当前能力包括：

- 上传本地 Markdown 文件
- 上传 Markdown 文本
- 追加或覆盖现有 docx 文档
- 读取文档元信息
- 读取完整块树或单页块列表
- 将 docx 文档导出为 Markdown
- 自动处理 LaTeX、Mermaid、本地图片和网络图片

## 安装与构建

此包位于 `feishu-markdown` monorepo 中。

```bash
corepack pnpm install
corepack pnpm --filter feishu-markdown-mcp build
```

本地运行：

```bash
node dist/index.js
```

## 环境变量

- `FEISHU_APP_ID`: 飞书应用 App ID
- `FEISHU_APP_SECRET`: 飞书应用 App Secret
- `FEISHU_USER_MOBILE`: 可选。创建新文档后用于转交 owner

## MCP 配置示例

```json
{
  "servers": {
    "Feishu Markdown": {
      "command": "npx",
      "args": ["-y", "feishu-markdown-mcp@latest"],
      "env": {
        "FEISHU_APP_ID": "your-app-id",
        "FEISHU_APP_SECRET": "your-app-secret"
      },
      "type": "stdio"
    }
  }
}
```

## 工具

### `set_config`

设置飞书配置。

- `appId`: string
- `appSecret`: string
- `feishuMobile?`: string

### `upload_markdown_file`

上传本地 Markdown 文件到飞书。

- `filePath`: string
- `title?`: string
- `folderToken?`: string
- `imageBaseDir?`: string
- `downloadImages?`: boolean
- `mermaid?`: object
- `batchSize?`: number
- `mermaidTempDir?`: string

### `upload_markdown_text`

上传 Markdown 文本到飞书。

- `text`: string
- `title?`: string
- `folderToken?`: string
- `imageBaseDir?`: string
- `downloadImages?`: boolean
- `mermaid?`: object
- `batchSize?`: number
- `mermaidTempDir?`: string

### `update_feishu_document`

向现有文档追加或覆盖 Markdown 内容。

- `url`: string
  说明：支持 `documentId` 或 `https://feishu.cn/docx/...`
  说明：v1 不支持 wiki URL
- `markdown`: string
- `mode`: `"append" | "replace"`
- `imageBaseDir?`: string
- `downloadImages?`: boolean
- `mermaid?`: object
- `batchSize?`: number
- `mermaidTempDir?`: string

### `get_document_info`

读取文档元信息。

- `document`: string
  说明：支持 `documentId` 或 `https://feishu.cn/docx/...`

### `get_document_blocks`

读取文档块结构。

- `document`: string
  说明：支持 `documentId` 或 `https://feishu.cn/docx/...`
- `blockId?`: string
- `recursive?`: boolean
  说明：默认 `true`
- `pageSize?`: number
  说明：仅在 `recursive=false` 时用于单页读取

### `export_markdown`

将 docx 文档导出为 Markdown。

- `document`: string
  说明：支持 `documentId` 或 `https://feishu.cn/docx/...`

## 开发

```bash
corepack pnpm --filter feishu-markdown-mcp test
corepack pnpm --filter feishu-markdown-mcp lint
corepack pnpm --filter feishu-markdown-mcp build
corepack pnpm --filter feishu-markdown-mcp validate:server
```
