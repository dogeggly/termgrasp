import net from "node:net";
import readline from "node:readline";
import {OpenAI} from "openai";
import {config} from 'dotenv';
import type Payload from "../share/payload.js";
import SOCKET_PATH from "../share/socket.js";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {getRecentHistory, getWikiDetail, getWikiIndex} from "../share/db.js";

// 初始化大模型客户端
config();
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL;
const LLM_MODEL = process.env.LLM_MODEL;

if (!LLM_API_KEY || !LLM_BASE_URL || !LLM_MODEL) {
    throw new Error('请配置 .env');
}

console.log('[DEBUG] OpenAI 配置:');
console.log(`  - baseURL: ${LLM_BASE_URL}`);
console.log(`  - model: ${LLM_MODEL}`);
console.log(`  - apiKey: ${LLM_API_KEY.substring(0, 10)}...`);

const openai = new OpenAI({
    apiKey: LLM_API_KEY,
    baseURL: LLM_BASE_URL
});

// 读取 settings.json
const __filename = fileURLToPath(import.meta.url);
const settingsPath = path.join(__filename, '../../../settings.json');
const settings: { global: string, why: string } = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

// 初始化会话 ID
const sessionId = crypto.randomUUID();

// 创建 UDS Server
const server: net.Server = net.createServer((connection: net.Socket): void => {
    console.log('Client 已连接');

    const rl = readline.createInterface({
        input: connection,
        crlfDelay: Infinity // 兼容 Windows(\r\n) 和 Linux(\n) 的换行符
    });

    rl.on('line', async (line: string): Promise<void> => {
        try {
            // 这时候的 line 绝对是完整的一条 JSON 字符串，直接 parse
            const payload: Payload = JSON.parse(line);
            connection.write('Server 收到指令，准备开始分析报错...\n');
            connection.write('----------------------------------------------------\n');
            console.log('收到解析请求，开始调用大模型...');

            if (payload.action === 'why') {
                const wikiIndex = getWikiIndex(sessionId);
                const recentHistory = getRecentHistory(sessionId);

                // 组装发给大模型的 Prompt
                const systemPrompt = settings.global ?? '';
                const userPrompt = `${settings.why}\n报错内容:${payload.errorLog}\n本轮历史中完整的对话:${recentHistory}\n本轮历史中对话压缩后的Wiki目录:${wikiIndex}`;

                const tools: OpenAI.Chat.ChatCompletionTool[] = [
                    {
                        type: "function",
                        function: {
                            name: "fetch_wiki_detail",
                            description: "当用户当前的问题与历史 Wiki 目录中的某个主题相关，且你需要了解该历史步骤的具体操作、报错代码或详细内容时，调用此工具获取详情。",
                            parameters: {
                                type: "object",
                                properties: {
                                    wiki_ids: {
                                        type: "array",
                                        items: {
                                            type: "integer"
                                        },
                                        description: "需要查阅的原始 Wiki 节点的 ID 数组，例如 [1, 3, 5]。",
                                    },
                                },
                                required: ["wiki_ids"],
                            },
                            strict: true
                        },
                    },
                ];

                const baseMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
                    {role: 'system', content: systemPrompt},
                    {role: 'user', content: userPrompt},
                ];

                // 第一次调用：先看是否触发 function calling
                const firstCompletion = await openai.chat.completions.create({
                    model: LLM_MODEL,
                    messages: baseMessages,
                    tools: tools,
                    tool_choice: "auto",
                });

                const firstResponse = firstCompletion.choices[0]?.message;

                if (!firstResponse) {
                    throw new Error('LLM 返回格式解析失败')
                }

                if (!firstResponse.tool_calls) {
                    if (!firstResponse.content) {
                        throw new Error('LLM 返回格式解析失败')
                    }
                    connection.write(firstResponse.content);
                    connection.write('\n----------------------------------------------------');
                    connection.write('\nLLM 分析完成');
                    connection.end();
                    return;
                }

                baseMessages.push(firstResponse);

                for (const tc of firstResponse.tool_calls) {
                    // fuck openai type!
                    const toolCall = tc as any;

                    if (toolCall.type !== 'function') {
                        baseMessages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: '不支持的工具类型。',
                        });
                    }

                    if (toolCall.function.name !== 'fetch_wiki_detail') {
                        baseMessages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: `不支持的工具:${toolCall.function.name}`,
                        });
                    }

                    const args = JSON.parse(toolCall.function.arguments) as { wiki_id: number[] };
                    const wikiDetail = getWikiDetail(args.wiki_id);

                    baseMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(wikiDetail),
                    });
                }

                const secondCompletion = await openai.chat.completions.create({
                    model: LLM_MODEL,
                    messages: baseMessages,
                    stream: true
                });

                for await (const chunk of secondCompletion) {
                    const content: string = chunk?.choices[0]?.delta?.content ?? '';
                    if (content) {
                        connection.write(content);
                    }
                }

                connection.write('\n----------------------------------------------------');
                connection.write('\nLLM 分析完成');
                connection.end();
            }
        } catch (err) {
            console.error('处理请求失败:', err);
            connection.write('\n----------------------------------------------------');
            connection.write('\nServer 内部处理失败');
            connection.end();
        }
    });

    connection.on('end', (): void => {
        console.log('Client 连接已关闭');
    })

    connection.on('error', (err: Error): void => {
        console.error('连接发生错误:', err.message);
    });
});

const cleanup = (): void => {
    if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
        console.log('正在清理资源...');
        fs.unlinkSync(SOCKET_PATH);
    }
};

const serverStart = (): void => {
    // 核心防御机制：启动前清理僵尸 Socket
    // 如果上一次进程异常崩溃，.sock 文件会遗留，导致 EADDRINUSE 错误
    cleanup()

    // 启动监听
    server.listen(SOCKET_PATH, (): void => {
        console.log(`守护进程已启动，正在监听 ${SOCKET_PATH}`);
    });

    server.on('error', (err: Error): void => {
        console.error('守护进程启动失败:', err.message);
    });

    // 优雅停机 (Graceful Shutdown)
    process.on('exit', cleanup); // 执行清理函数，测试环境下只是停止了 tsx，其子进程会被 tsx 强杀，触发不了
    process.on('SIGINT', (): never => process.exit(0));  // 捕获 2 信号，即 Ctrl+C
    process.on('SIGTERM', (): never => process.exit(0)); // 捕获 15 信号，即 kill 命令
}

export default serverStart;

