import {OpenAI} from "openai";
import {getRecentHistory, saveSessionWiki} from "./db.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import {z} from 'zod';
import {zodResponseFormat} from 'openai/helpers/zod';

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

const compact = async (): Promise<void> => {
    const recentHistory = getRecentHistory();

    const systemPrompt: string = settings.global ?? '';
    const userPrompt = `你是一个资深的程序员助手。请根据用户提供的历史终端信息与LLM的完整分析结果，写一份总结性的 Wiki 条目。`;

    const baseMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {role: 'system', content: systemPrompt},
        {role: 'user', content: userPrompt},
    ];

    const WikiEntriesSchema = z.array(
        z.object({
            title: z.string().describe("提炼的独立标题，尽量简短。"),
            detail_md: z.string().describe("详细的分析过程、解决方案或核心代码，必须使用优雅的 Markdown 格式。")
        }));

    const Completion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: baseMessages,
        response_format: zodResponseFormat(WikiEntriesSchema, "wiki_extraction"),
        temperature: 0.2, // 提取信息的任务，温度放低
    });

    const response = Completion.choices[0]?.message;

    if (!response || !response.content) {
        console.error('LLM 返回格式解析失败');
        return;
    }

    const validatedData = WikiEntriesSchema.parse(response.content);

    const chatHistoryIds = recentHistory.map((chatHistory) => chatHistory.id);

    // 将 entries 转换为 saveSessionWiki 期望的格式
    const wikiRecords: [string, string][] = validatedData.map(wiki => [
        wiki.title,
        wiki.detail_md,
    ]);

    saveSessionWiki(chatHistoryIds, wikiRecords)

    console.log('总结 Wiki 条目完毕');
}

compact()