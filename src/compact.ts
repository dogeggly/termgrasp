import {OpenAI} from "openai";
import {getRecentHistory, saveSessionWiki} from "./db.js";
import {z} from 'zod';
import {zodResponseFormat} from 'openai/helpers/zod';
import "dotenv/config";
import ora, {type Ora} from "ora";
import {extractEntryFromText, formatHistory, LLM_MODEL, openai, settings} from "./share.js";

const compact = async (): Promise<void> => {
    const recentHistory = getRecentHistory();

    const systemPrompt: string = `${settings.global}\n${settings.compact}`;
    const historyText = formatHistory(recentHistory);
    if (!historyText) {
        console.log('没有历史记录可供分析');
        return;
    }
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

    const spinner: Ora = ora({
        text: '准备开始压缩...',
        color: 'cyan',
        spinner: 'dots' // 经典的三个点跳动动画
    }).start();

    const Completion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: baseMessages,
        response_format: zodResponseFormat(WikiEntriesSchema, "wiki_extraction"),
        temperature: 0.2, // 提取信息的任务，温度放低
    });

    const response = Completion.choices[0]?.message;

    if (!response || !response.content) {
        spinner.fail('LLM 返回格式解析失败')
        return;
    }

    const extracted = extractEntryFromText(response.content);
    if (!extracted) {
        throw Error(`LLM 压缩返回内容无法解析为条目。原始内容:${response.content}`);
    }

    const validatedData = WikiEntriesSchema.parse(extracted);

    const chatHistoryIds = recentHistory.map((chatHistory) => chatHistory.id);

    // 将 entries 转换为 saveSessionWiki 期望的格式
    const wikiRecords: [string, string][] = validatedData.entries.map(wiki => [
        wiki.title,
        wiki.detail_md,
    ]);

    saveSessionWiki(chatHistoryIds, wikiRecords);

    spinner.succeed('总结 Wiki 条目完毕');
}

compact();