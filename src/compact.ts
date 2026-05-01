import {OpenAI} from "openai";
import {getRecentHistory, saveSessionWiki} from "./db.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import {z} from 'zod';
import {zodResponseFormat} from 'openai/helpers/zod';
import "dotenv/config";
import ora, {type Ora} from "ora";

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

const __filename = fileURLToPath(import.meta.url);
const settingsPath = path.join(__filename, '../../settings.json');
const settings: { global: string } = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

const formatHistory = (items: { id: number; content: string }[]) =>
    items.map(item => `ID:${item.id}\n内容:${item.content}`).join('\n\n');

const extractEntryFromText = (content: string) => {
    const titleMatch = content.match(/(?:^|\n)\s*title\s*[:：]\s*(.+)/i);
    const detailMatch = content.match(/(?:^|\n)\s*detail_md\s*[:：]\s*([\s\S]+)/i);

    if (!titleMatch && !detailMatch) {
        return null;
    }

    return {
        entries: [
            {
                title: (titleMatch?.[1] || '').trim(),
                detail_md: (detailMatch?.[1] || '').trim(),
            }
        ]
    };
};

const compact = async (): Promise<void> => {
    const recentHistory = getRecentHistory();

    const systemPrompt: string = settings.global ?? '';
    const historyText = formatHistory(recentHistory);
    if (!historyText) {
        console.log('没有历史记录可供分析');
        return;
    }
    const userPrompt = `你是一个资深的程序员助手。请根据用户提供的历史终端信息与LLM的完整分析结果，写一份总结性的 Wiki 条目。要求 title 在 15 字以内，detail_md 在 100 字以内\n本轮历史中完整的对话:\n${historyText}`;

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
        throw Error(`LLM 返回内容无法解析为条目。原始内容:${response.content}`);
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