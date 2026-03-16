import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  FeishuMarkdown,
  type FeishuMarkdownOptions,
} from 'feishu-markdown';

import pkg from '../package.json' with { type: 'json' };
import { registerFeishuMarkdownTools } from './server.js';

let feishuConfig: FeishuMarkdownOptions | null = null;

function getFeishuMarkdown(): FeishuMarkdown {
  if (!feishuConfig) {
    throw new Error(
      'Feishu configuration is missing. Use set_config or environment variables first.'
    );
  }

  return new FeishuMarkdown(feishuConfig);
}

function setConfig(config: FeishuMarkdownOptions): void {
  feishuConfig = config;
}

function createServer(): McpServer {
  const server = new McpServer({
    name: 'feishu-markdown-mcp',
    version: pkg.version,
  });

  registerFeishuMarkdownTools(server, {
    getFeishuMarkdown,
    setConfig,
  });

  return server;
}

async function run(): Promise<void> {
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
    setConfig({
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
      feishuMobile: process.env.FEISHU_USER_MOBILE,
    });
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Feishu Markdown MCP Server running on stdio');
}

run().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
