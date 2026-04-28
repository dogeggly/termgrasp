# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目架构

TermGrasp 是一个 C/S（客户端/服务端）架构的终端助手，使用 Node.js 本地进程间通信（IPC）连接客户端和守护进程。

### 通信机制
- **Windows**: 使用 Named Pipe (`\\.\pipe\termgrasp-ipc`)
- **Mac/Linux**: 使用 Unix Domain Socket (`/tmp/termgrasp.sock`)

### 目录结构
- `src/client/` - 客户端代码，负责从剪贴板读取错误并发送到服务端
- `src/server/` - 服务端代码，守护进程，负责处理请求并调用大模型
- `src/share/` - 客户端和服务端共享的代码（socket 路径、数据类型）
- `bin/tg.js` - 全局命令入口（通过 `npm link` 安装）
- `src/index.ts` - 服务端主入口

### 数据流
1. 用户运行 `tg why`
2. 客户端从剪贴板读取错误日志
3. 通过 Socket/Pipe 发送 JSON 格式的 Payload 到服务端
4. 服务端调用大模型（OpenAI 接口兼容），流式返回分析结果
5. 客户端实时输出大模型的响应

### TypeScript 配置
- 模块系统：`nodenext`
- 目标版本：ES2020
- 严格模式开启
- `.ts` 文件必须使用 `.js` 扩展名进行导入（verbatimModuleSyntax）

## 常用命令

### 开发流程
```bash
# 安装依赖
npm install

# 配置环境变量（需要创建 .env 文件）
# LLM_API_KEY=xxxxxxxxxxxxxxxx
# LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
# LLM_MODEL=glm-4.5

# 编译 TypeScript
npm run build

# 启动守护进程（服务端）
npm run start

# 开发模式（自动重新编译）
npm run dev

# 挂载全局命令（首次使用需要）
npm link

# 使用命令（需要先启动守护进程）
tg why
```

### 重新构建和测试
修改代码后需要重新编译：
```bash
npm run build  # 重新编译
npm run start  # 重启守护进程（或使用 Ctrl+C 停止后重新启动）
```

## 重要注意事项

1. **导入路径**: 由于 `verbatimModuleSyntax` 配置，所有 TypeScript 文件导入时必须使用 `.js` 扩展名，即使源文件是 `.ts`。

2. **服务端清理**: 服务端启动时会自动清理遗留的 Socket 文件，但 Windows 下 Named Pipe 不需要清理。

3. **流式输出**: 服务端使用 OpenAI 的流式 API，将大模型的每个 Token 实时转发给客户端。

4. **跨平台换行符**: 客户端使用 `readline` 的 `crlfDelay: Infinity` 兼容 Windows (\r\n) 和 Linux (\n) 的换行符。

5. **依赖 better-sqlite3**: 这是一个原生模块，可能需要在特定平台上重新编译。如果遇到问题，尝试删除 `node_modules` 和 `package-lock.json` 后重新安装。
