import {OpenAI} from "openai";
import {fileURLToPath} from "url";
import path from "path";
import fs from "fs";

export function extractEntryFromText(content: string): { entries: { title: string; detail_md: string }[] } | null {
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
}

export function formatHistory(items: { id: number; content: string }[]): string {
    return items.map(item => `ID:${item.id}\n内容:${item.content}`).join('\n\n');
}

const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL;
const MODEL = process.env.LLM_MODEL;

if (!LLM_API_KEY || !LLM_BASE_URL || !MODEL) {
    throw Error('LLM_API_KEY, LLM_BASE_URL, LLM_MODEL 环境变量必须设置');
}

export const openai = new OpenAI({
    apiKey: LLM_API_KEY,
    baseURL: LLM_BASE_URL
});

export const LLM_MODEL = MODEL;

// 读取 settings.json
const __filename = fileURLToPath(import.meta.url);
const settingsPath = path.join(__filename, '../../settings.json');
export const settings: {
    global: string;
    why: string;
    compact: string
} = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));