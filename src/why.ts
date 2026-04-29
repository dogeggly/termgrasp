import clipboard from "clipboardy";
import {getRecentHistory, getWikiDetail, getWikiIndex, saveChatMsg} from "./db.js";
import {OpenAI} from "openai";
import ora, {type Ora} from "ora";
import {marked} from "marked";
import TerminalRenderer from "marked-terminal";
import "dotenv/config";
import {fileURLToPath} from "url";
import path from "path";
import fs from "fs";

// 初始化大模型客户端
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL;
const LLM_MODEL = process.env.LLM_MODEL;

if (!LLM_API_KEY || !LLM_BASE_URL || !LLM_MODEL) {
    throw Error('LLM_API_KEY, LLM_BASE_URL, LLM_MODEL 环境变量必须设置');
}

const openai = new OpenAI({
    apiKey: LLM_API_KEY,
    baseURL: LLM_BASE_URL
});

// 读取 settings.json
const __filename = fileURLToPath(import.meta.url);
const settingsPath = path.join(__filename, '../../settings.json');
const settings: { global: string } = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

// 配置 marked 使用 TerminalRenderer 来渲染 Markdown
marked.setOptions({
    renderer: new TerminalRenderer() as any
});

interface SafeToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: { wiki_id: number[] };
    };
}

const why = async (): Promise<void> => {
    const errorLog: string = clipboard.readSync();
    if (!errorLog || !errorLog.trim()) {
        console.log('剪贴板是空的，请先用鼠标选中一下终端里的信息哦！');
        return;
    }

    const spinner: Ora = ora({
        text: '准备开始分析...',
        color: 'cyan',
        spinner: 'dots' // 经典的三个点跳动动画
    }).start();

    const wikiIndex = getWikiIndex();
    const recentHistory = getRecentHistory();

    // 组装发给大模型的 Prompt
    const systemPrompt: string = settings.global ?? '';
    const userPrompt = `你是一个资深的程序员助手。请分析用户提供的终端信息，给出说明或解决方案。必要时提供相关命令，并说明命令是干什么的，解决什么问题。
    \n终端内容:${errorLog}\n本轮历史中完整的对话:${recentHistory}\n本轮历史中对话压缩后的Wiki目录:${wikiIndex}`;

    const tools: OpenAI.Chat.ChatCompletionTool[] = [
        {
            type: "function",
            function: {
                name: "fetch_wiki_detail",
                description: "当用户当前的问题与历史 Wiki 目录中的某个主题相关，且你需要了解该历史步骤的详细内容时，调用此工具获取详情。",
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
        spinner.fail('LLM 返回格式解析失败');
        return;
    }

    if (!firstResponse.tool_calls) {
        if (!firstResponse.content) {
            spinner.fail('LLM 返回格式解析失败');
            return;
        }
        spinner.succeed('----------------------------------------------------');
        console.log(marked(firstResponse.content));
        console.log('----------------------------------------------------');
        console.log('LLM 分析完成');
        saveChatMsg(`历史终端信息:${errorLog}\nLLM的完整分析结果:${firstResponse.content}`);
        return;
    }

    baseMessages.push(firstResponse);

    for (const tc of firstResponse.tool_calls) {
        // fuck openai type!
        const toolCall = tc as unknown as SafeToolCall;

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

        const args = toolCall.function.arguments;
        const wikiDetail = getWikiDetail(args.wiki_id);

        baseMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `历史 Wiki 目录中 ${args.wiki_id} 号 id 的详细内容如下:${wikiDetail}`,
        });
    }

    const secondCompletion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: baseMessages,
    });

    const secondResponse = secondCompletion.choices[0]?.message;

    if (!secondResponse || !secondResponse.content) {
        spinner.fail('LLM 返回格式解析失败');
        return;
    }

    spinner.succeed('----------------------------------------------------');
    console.log(marked(secondResponse.content));
    console.log('----------------------------------------------------');
    console.log('LLM 分析完成');
    saveChatMsg(`历史终端信息:${errorLog}\nLLM的完整分析结果:${secondResponse.content}`);
}

why();
