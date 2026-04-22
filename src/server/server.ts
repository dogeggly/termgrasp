import net from "node:net";
import readline from "node:readline";
import {OpenAI} from "openai";
import {config} from 'dotenv';
import type Payload from "../share/payload.js";

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

// 创建 UDS Server
export const server: net.Server = net.createServer((connection: net.Socket): void => {
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
                // 组装发给大模型的 Prompt
                const systemPrompt = `你是一个资深的程序员助手。
                    请分析用户提供的终端信息，给出最直接的说明或解决方案。
                    必要时提供相关命令，并说明命令是干什么的，解决什么问题。
                    请使用 Plain Text 进行回复，不要使用任何 Markdown 格式，并通过合理的换行来排版。`;
                const userPrompt = `报错内容:\n${payload.errorLog}`;

                // 发起流式请求 (Stream)
                const stream = await openai.chat.completions.create({
                    model: LLM_MODEL,
                    messages: [
                        {role: 'system', content: systemPrompt},
                        {role: 'user', content: userPrompt}
                    ],
                    stream: true,   // 开启流式输出
                });

                // 将大模型吐出的每一个 Token，实时转发给 Client
                for await (const chunk of stream) {
                    const content: string = chunk?.choices[0]?.delta?.content ?? '';
                    if (content) {
                        connection.write(content);
                    }
                }

                connection.write('\n----------------------------------------------------');
                connection.write('\nServer 分析完成');
                connection.end();
                console.log('Client 连接已关闭');
            }
        } catch (err) {
            connection.write('\n----------------------------------------------------');
            connection.write('\nServer 内部处理失败');
            connection.end();
            console.error('处理请求失败:', err);
        }
    });

    connection.on('end', (): void => {
        console.log('Client 连接已关闭');
    })

    connection.on('error', (err: Error): void => {
        console.error('连接发生错误:', err.message);
    });
});

