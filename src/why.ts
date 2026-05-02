import clipboard from "clipboardy";
import {
    type ChatHistory,
    getRecentHistory,
    getWikiDetail,
    getWikiIndex,
    type LLMPrompt,
    saveChatMsg,
    saveSessionWiki
} from "./db.js";
import {OpenAI} from "openai";
import ora, {type Ora} from "ora";
import {marked} from "marked";
import TerminalRenderer from "marked-terminal";
import "dotenv/config";
import {z} from "zod";
import {zodResponseFormat} from "openai/helpers/zod";
import {extractEntryFromText, formatHistory, LLM_MODEL, openai, settings} from "./share.js";
import {readFileTool, readFileToolHandler, type ReadFileArgs} from "./tools.js";

// 配置 marked 使用 TerminalRenderer 来渲染 Markdown
marked.setOptions({
    renderer: new TerminalRenderer() as any
});

interface SafeToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string | {
            wiki_id?: number[];
            wiki_ids?: number[];
            file_path?: string;
            start_line?: number;
            end_line?: number;
            max_chars?: number;
        };
    };
}

const parseToolArgs = <T>(input: SafeToolCall['function']['arguments']): T => {
    if (typeof input === 'string') {
        try {
            return JSON.parse(input) as T;
        } catch (error: Error | unknown) {
            const message = error instanceof Error ? error.message : String(error);
            throw Error(`LLM 返回的工具参数无法解析为 JSON:${message}`);
        }
    }

    return input as T;
};

const parseCliArgs = (argv: string[]) => {
    let extraMessage = '';
    let single = false;

    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];

        if (token === '-s' || token === '--single') {
            single = true;
            continue;
        }

        if (token === '-m' || token === '--message') {
            const next = argv[i + 1];
            if (next && !next.startsWith('-')) {
                extraMessage = `补充信息:${next}`;
                i += 1;
            }
        }
    }

    return {extraMessage, single};
};

const searchWikiTool: OpenAI.Chat.ChatCompletionTool = {
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
}

const formatWikiIndex = (items: { id: number; title: string }[]): string =>
    items.map(item => `ID:${item.id}\n标题:${item.title}`).join('\n\n');

const formatWikiDetail = (items: { id: number; detail_md: string }[]): string =>
    items.map(item => `ID:${item.id}\n详情:${item.detail_md}`).join('\n\n');

const autoCompactHistory = async (items: LLMPrompt<ChatHistory, 'id' | 'content'>[]): Promise<void> => {
    const toCompact = items.slice(10);
    const historyText = formatHistory(toCompact);
    const systemPrompt: string = `${settings.global}\n${settings.compact}`;
    const userPrompt = `本轮历史中完整的对话:\n${historyText}`;

    const baseMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {role: 'system', content: systemPrompt},
        {role: 'user', content: userPrompt},
    ];

    const WikiEntriesSchema = z.object({
        entries: z.array(
            z.object({
                title: z.string().describe("提炼的独立标题，尽量简短。"),
                detail_md: z.string().describe("详细的分析过程、解决方案或核心代码，必须使用优雅的 Markdown 格式。")
            })
        )
    });

    const completion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: baseMessages,
        response_format: zodResponseFormat(WikiEntriesSchema, "wiki_extraction"),
        temperature: 0.2,
    });

    const response = completion.choices[0]?.message;

    if (!response || !response.content) {
        throw Error('LLM 返回格式解析失败');
    }

    const extracted = extractEntryFromText(response.content);
    if (!extracted) {
        throw Error(`LLM 压缩返回内容无法解析为条目。原始内容:${response.content}`);
    }

    const validatedData = WikiEntriesSchema.parse(extracted);
    const chatHistoryIds = toCompact.map((chatHistory) => chatHistory.id);
    const wikiRecords: [string, string][] = validatedData.entries.map(wiki => [
        wiki.title,
        wiki.detail_md,
    ]);

    saveSessionWiki(chatHistoryIds, wikiRecords);
};

const why = async (): Promise<void> => {
    let spinner: Ora | null = null;

    try {
        const {extraMessage, single} = parseCliArgs(process.argv.slice(2));
        const termLog: string = clipboard.readSync();
        if (!termLog || !termLog.trim()) {
            console.log('剪贴板是空的，请先用鼠标选中一下终端里的信息哦！');
            return;
        }

        spinner = ora({
            text: '准备开始分析...',
            color: 'cyan',
            spinner: 'dots' // 经典的三个点跳动动画
        }).start();

        let recentHistory = single ? [] : getRecentHistory();
        if (recentHistory.length > 15) {
            await autoCompactHistory(recentHistory);
            recentHistory = recentHistory.slice(0, 10);
        }
        const wikiIndex = single ? [] : getWikiIndex();

        // 组装发给大模型的 Prompt
        const systemPrompt: string = `${settings.global}\n${settings.why}`;
        const historyText = formatHistory(recentHistory);
        const wikiIndexText = formatWikiIndex(wikiIndex);
        const userPrompt = `终端内容:${termLog}\n${extraMessage}\n本轮历史中完整的对话:\n${historyText || '无'}\n本轮历史中对话压缩后的Wiki目录:\n${wikiIndexText || '无'}`;

        const tools: OpenAI.Chat.ChatCompletionTool[] = [
            searchWikiTool,
            readFileTool,
        ];

        const baseMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            {role: 'system', content: systemPrompt},
            {role: 'user', content: userPrompt},
        ];

        // 第一次调用：先看是否触发 function calling
        let firstCompletion;
        if (single) {
            firstCompletion = await openai.chat.completions.create({
                model: LLM_MODEL,
                messages: baseMessages
            });
        } else {
            firstCompletion = await openai.chat.completions.create({
                model: LLM_MODEL,
                messages: baseMessages,
                tools: tools,
                tool_choice: "auto",
            });
        }

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
            if (!single) {
                saveChatMsg(`历史终端信息:${termLog}\nLLM的完整分析结果:${firstResponse.content}`);
            }
            return;
        }

        baseMessages.push(firstResponse);

        for (const tc of firstResponse.tool_calls) {
            // fuck openai type!
            const toolCall = tc as unknown as SafeToolCall;

            if (toolCall.type !== 'function') {
                throw Error('LLM 调用了不支持的工具类型');
            }

            if (toolCall.function.name === 'fetch_wiki_detail') {
                const args = parseToolArgs<{ wiki_id?: number[]; wiki_ids?: number[] }>(toolCall.function.arguments);
                const wikiIds = args.wiki_ids ?? args.wiki_id;
                if (!Array.isArray(wikiIds) || wikiIds.length === 0) {
                    throw Error('LLM 调用工具的参数错误');
                }

                const wikiDetail = getWikiDetail(wikiIds);
                const wikiDetailText = formatWikiDetail(wikiDetail);

                baseMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: `历史 Wiki 目录中 ${wikiIds} 号 id 的详细内容如下:\n${wikiDetailText || '无'}`,
                });
                continue;
            }

            if (toolCall.function.name === 'read_file') {
                const args = parseToolArgs<ReadFileArgs>(toolCall.function.arguments);
                const content = readFileToolHandler(args);
                baseMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content,
                });
                continue;
            }

            throw Error('LLM 调用了不支持的工具类型');
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
        if (!single) {
            saveChatMsg(`历史终端信息:${termLog}\nLLM的完整分析结果:${secondResponse.content}`);
        }
    } catch (error: Error | unknown) {
        if (spinner) {
            spinner.fail('分析失败');
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        throw error;
    }
}

why();
