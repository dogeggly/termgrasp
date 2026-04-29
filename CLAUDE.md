# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

TermGrasp 是一个终端分析工具，使用大模型帮助开发者理解并解决终端错误。使用方法：选中终端内容复制到剪贴板，然后运行 `tg why` 命令即可获得分析结果。

## 核心架构

### 主要模块
- **src/config.ts**: 初始化配置，包括 OpenAI 客户端、环境变量加载和 Markdown 渲染器设置
- **src/db.ts**: 数据库操作模块，使用 better-sqlite3 实现本地记忆存储（短期记忆和长期记忆）
- **src/client/why.ts**: 核心业务逻辑，处理剪贴板内容、LLM 对话和工具调用
- **bin/tg.js**: 命令行入口，通过 Commander 处理 CLI 命令

### 记忆系统
- **短期记忆** (chat_history): 存储未压缩的原始对话内容，使用 `is_compacted` 标记
- **长期记忆** (session_wiki): 存储压缩后的知识点，包含标题和详细内容
- 会话隔离：每个分析任务使用 `sessionId` 隔离

### LLM 交互流程
1. 读取剪贴板内容
2. 组合系统提示、用户提示、历史对话和历史 Wiki
3. 第一次调用 LLM 检查是否需要调用工具函数
4. 如果需要，使用工具函数获取历史详情
5. 第二次调用 LLM 生成最终分析结果
6. 保存对话到记忆系统

## 开发命令

### 构建和运行
```bash
# 安装依赖
npm install

# 构建项目
npm run build

# 链接全局命令（安装后可使用 tg 命令）
npm link

# 开发模式运行（无需构建）
npx tsx src/client/why.ts
```

### 环境配置
创建 `.env` 文件：
```
LLM_API_KEY=xxxxxxxxxxxxxxxx
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
LLM_MODEL=glm-4.5
```

### 数据库
- 数据库文件存储在 `tables/.tg_data.db`
- 使用 SQLite WAL 模式提升并发性能
- 表结构包含：chat_history（短期记忆）和 session_wiki（长期记忆）

## 技术栈
- TypeScript with ES2020 modules
- OpenAI API（通过自定义 baseURL）
- better-sqlite3 数据库
- marked + marked-terminal Markdown 渲染
- Commander.js CLI 框架
- clipboardy 剪贴板操作

## 注意事项
- 项目使用 ES2020 modules，需要 Node.js 支持的运行环境
- 每次启动时会生成新的 sessionId，用于当前会话的隔离
- 历史记忆会持久化存储，但不会跨会话共享
- 工具函数目前只支持 `fetch_wiki_detail` 用于获取历史详情