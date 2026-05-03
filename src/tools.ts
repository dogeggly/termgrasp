import fs from "fs";
import path from "path";
import {OpenAI} from "openai";

export type ReadFileArgs = {
    file_path: string;
    start_line?: number;
    end_line?: number;
    max_chars?: number;
};

export type ReadFileResult = {
    file_path: string;
    start_line: number;
    end_line: number;
    total_lines: number;
    truncated: boolean;
    content: string;
};

const DEFAULT_MAX_CHARS = 12000;
const WORKSPACE_ROOT = process.cwd();

const resolveWorkspacePath = (inputPath: string): string => {
    const resolved = path.resolve(WORKSPACE_ROOT, inputPath);
    const relative = path.relative(WORKSPACE_ROOT, resolved);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw Error('LLM 要调用的文件目标路径不在工作区内');
    }

    return resolved;
};

const normalizeLineNumber = (value: number | undefined, fallback: number): number => {
    if (value === undefined) {
        return fallback;
    }

    const parsed = Math.floor(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return parsed;
};

export const readFileTool: OpenAI.Chat.ChatCompletionTool = {
    type: "function",
    function: {
        name: "read_file",
        description: "读取工作区内的文件内容，支持按行号范围读取。",
        parameters: {
            type: "object",
            properties: {
                file_path: {
                    type: "string",
                    description: "相对工作区根目录的文件路径，例如 src/why.ts。",
                },
                start_line: {
                    type: "integer",
                    description: "起始行号（从 1 开始）。",
                },
                end_line: {
                    type: "integer",
                    description: "结束行号（包含）。",
                },
                max_chars: {
                    type: "integer",
                    description: "返回内容的最大字符数，超出会截断。",
                },
            },
            required: ["file_path"],
        },
        strict: true,
    },
};

export function readFileToolHandler(args: ReadFileArgs): string {
    const safePath = resolveWorkspacePath(args.file_path);
    if (!fs.existsSync(safePath)) {
        throw Error('LLM 要调用的文件不存在');
    }

    const raw = fs.readFileSync(safePath, "utf8");
    const lines = raw.split(/\r?\n/);
    const startLine = Math.max(1, normalizeLineNumber(args.start_line, 1));
    const endLine = Math.min(lines.length, normalizeLineNumber(args.end_line, lines.length));
    if (startLine > endLine) {
        throw Error('LLM 提供的行号范围无效，起始行号必须小于或等于结束行号');
    }
    const selected = lines.slice(startLine - 1, endLine).join("\n");
    const maxChars = Math.max(DEFAULT_MAX_CHARS, normalizeLineNumber(args.max_chars, DEFAULT_MAX_CHARS));
    const truncated = selected.length > maxChars;

    const result: ReadFileResult = {
        file_path: args.file_path,
        start_line: startLine,
        end_line: Math.min(endLine, lines.length),
        total_lines: lines.length,
        truncated,
        content: truncated ? `${selected.slice(0, maxChars)}\n... (truncated)` : selected,
    };

    return JSON.stringify(result, null, 2);
};
