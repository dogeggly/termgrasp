import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {fileURLToPath} from "node:url";

// 1. 确定数据库文件路径
const __filename = fileURLToPath(import.meta.url);
const dbDir = path.join(__filename, '../../../tables');
const dbPath = path.join(dbDir, '.tg_data.db');

// 2. 确保目录存在
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, {recursive: true});
}

// 3. 连接数据库（如果文件不存在，better-sqlite3 会自动创建它）
const db: Database.Database = new Database(dbPath);

// 4. 初始化表结构
const initDB = (): void => {
    // 开启 WAL 模式，大幅提升 SQLite 的并发读写性能
    db.pragma('journal_mode = WAL');

    // 创建短期记忆表 (chat_history)
    db.exec(`
        CREATE TABLE IF NOT EXISTS chat_history
        (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id   TEXT,               -- 当前会话 ID
            content      TEXT,               -- 原始对话内容
            is_compacted INTEGER  DEFAULT 0, -- 关键：标记该条目是否已被压缩进 Wiki
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // 创建长期记忆表 (session_wiki)
    db.exec(`
        CREATE TABLE IF NOT EXISTS session_wiki
        (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            title      TEXT, -- 对话块的摘要标题
            detail_md  TEXT, -- 详细的知识点、报错代码或解决方案
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

export default initDB;

interface ChatHistory {
    id: number;
    session_id: string;
    content: string;
    is_compacted: number;
    created_at: string;
}

interface SessionWiki {
    id: number;
    session_id: string;
    title: string;
    detail_md: string;
    created_at: string;
}

type LLMPrompt<T, K extends keyof T> = { [P in K]: T[P] };

// 获取长期记忆“目录”
export function getWikiIndex(sessionId: string): LLMPrompt<SessionWiki, 'id' | 'title'>[] {
    const stmt = db.prepare(`SELECT id, title
                             FROM session_wiki
                             WHERE session_id = ?
                             ORDER BY created_at DESC`);
    return stmt.all(sessionId) as LLMPrompt<SessionWiki, 'id' | 'title'>[];
}

// 批量获取按需披露的"详情"
export function getWikiDetail(ids: number[]): LLMPrompt<SessionWiki, 'id' | 'detail_md'>[] {
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`SELECT id, detail_md
                             FROM session_wiki
                             WHERE id IN (${placeholders})`);
    return stmt.all(...ids) as LLMPrompt<SessionWiki, 'id' | 'detail_md'>[];
}

// 获取短期记忆（未被压缩的近期对话流）
export function getRecentHistory(sessionId: string): LLMPrompt<ChatHistory, 'id' | 'content'>[] {
    const stmt = db.prepare(`SELECT id, content
                             FROM chat_history
                             WHERE session_id = ?
                               AND is_compacted = 0
                             ORDER BY created_at DESC`);
    return stmt.all(sessionId) as LLMPrompt<ChatHistory, 'id' | 'content'>[];
}

// 保存新对话到短期记忆
export function saveChatMsg(sessionId: string, content: string): void {
    db.prepare(`INSERT INTO chat_history (session_id, content)
                VALUES (?, ?)`).run(sessionId, content);
}

// 批量保存新对话到长期记忆
export function saveSessionWiki(chatHistoryIds: number[], wikiRecords: [string, string, string][]): void {
    const wikiPlaceholders = wikiRecords.map(() => '(?, ?, ?)').join(',');
    const historyPlaceholders = chatHistoryIds.map(() => '?').join(',');

    const transaction = db.transaction(() => {
        const insertStmt = db.prepare(`INSERT INTO session_wiki (session_id, title, detail_md)
                                       VALUES ${wikiPlaceholders}`);
        const insertValues = wikiRecords.flat();
        insertStmt.run(...insertValues);

        const updateStmt = db.prepare(`UPDATE chat_history
                                       SET is_compacted = 1
                                       WHERE id IN (${historyPlaceholders})`);
        updateStmt.run(...chatHistoryIds);
    });

    transaction();
}