import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {fileURLToPath} from "url";

// 1. 确定数据库文件路径
const __filename = fileURLToPath(import.meta.url);
const dbDir = path.join(__filename, '../../tables');
const dbPath = path.join(dbDir, '.tg_data.db');

// 2. 确保目录存在
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, {recursive: true});
}

// 3. 连接数据库（如果文件不存在，better-sqlite3 会自动创建它）
const db: Database.Database = new Database(dbPath);

// 4. 初始化表结构
// 创建短期记忆表 (chat_history)
db.exec(`
    CREATE TABLE IF NOT EXISTS chat_history
    (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id   INTEGER,            -- 当前会话 ID
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
        session_id INTEGER,
        title      TEXT, -- 对话块的摘要标题
        detail_md  TEXT, -- 详细的知识点或解决方案
        chat_ids   TEXT, -- 关联的 chat_history ID 列表（逗号分隔）
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// 创建会话表 (sessions)
db.exec(`
    CREATE TABLE IF NOT EXISTS sessions
    (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// 5. 查询会话
const getSessions = (): { id: number }[] => {
    const stmt = db.prepare(`SELECT id
                             FROM sessions
                             ORDER BY created_at DESC
                             LIMIT 1`);
    return stmt.all() as { id: number }[];
};

let sessions = getSessions();
if (!sessions || sessions.length === 0) {
    createSessionRecord();
}
sessions = getSessions();
const sessionId = sessions[0]!.id;

interface ChatHistory {
    id: number;
    session_id: number;
    content: string;
    is_compacted: number;
    created_at: string;
}

interface SessionWiki {
    id: number;
    session_id: number;
    title: string;
    detail_md: string;
    chat_ids: string; // 存储关联的 chat_history ID 列表，格式为 "1,3,5"
    created_at: string;
}

interface session {
    id: number;
    created_at: string;
}

type LLMPrompt<T, K extends keyof T> = { [P in K]: T[P] };

// 获取长期记忆“目录”
export function getWikiIndex(): LLMPrompt<SessionWiki, 'id' | 'title'>[] {
    const stmt = db.prepare(`SELECT id, title
                             FROM session_wiki
                             WHERE session_id = ?`);
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

// 获取长期记忆的完整内容（目录 + 详情）
export function getWiki(): SessionWiki[] {
    const stmt = db.prepare(`SELECT *
                             FROM session_wiki
                             WHERE session_id = ?`);
    return stmt.all(sessionId) as SessionWiki[];
}

// 获取短期记忆（未被压缩的近期对话流）
export function getRecentHistory(): LLMPrompt<ChatHistory, 'id' | 'content'>[] {
    const stmt = db.prepare(`SELECT id, content
                             FROM chat_history
                             WHERE session_id = ?
                               AND is_compacted = 0`);
    return stmt.all(sessionId) as LLMPrompt<ChatHistory, 'id' | 'content'>[];
}

// 获取短期记忆的完整内容（包括已压缩和未压缩的对话）
export function getFullHistory(): ChatHistory[] {
    const stmt = db.prepare(`SELECT *
                             FROM chat_history
                             WHERE session_id = ?`);
    return stmt.all(sessionId) as ChatHistory[];
}

// 保存新对话到短期记忆
export function saveChatMsg(content: string): void {
    db.prepare(`INSERT INTO chat_history (session_id, content)
                VALUES (?, ?)`).run(sessionId, content);
}

// 批量保存新对话到长期记忆
export function saveSessionWiki(chatHistoryIds: number[], wikiRecords: [string, string][]): void {
    const wikiPlaceholders = wikiRecords.map(() => '(?, ?, ?, ?)').join(',');
    const historyPlaceholders = chatHistoryIds.map(() => '?').join(',');

    const transaction = db.transaction((): void => {
        const insertStmt = db.prepare(`INSERT INTO session_wiki (session_id, title, detail_md, chat_ids)
                                       VALUES ${wikiPlaceholders}`);
        const chatIds = chatHistoryIds.join(',');
        const insertValues = wikiRecords.map((wiki) => [sessionId, wiki[0], wiki[1], chatIds]).flat();
        insertStmt.run(...insertValues);

        const updateStmt = db.prepare(`UPDATE chat_history
                                       SET is_compacted = 1
                                       WHERE id IN (${historyPlaceholders})`);
        updateStmt.run(...chatHistoryIds);
    });

    transaction();
}

// 还原压缩后的对话（将 Wiki 详情重新插入短期记忆）
export function restoreCompactedHistory(wikiId: number): void {
    const wikiStmt = db.prepare(`SELECT chat_ids
                                 FROM session_wiki
                                 WHERE id = ?`);
    const wikiRow = wikiStmt.get(wikiId) as { chat_ids: string };

    const chatHistoryIds = wikiRow.chat_ids
        .split(',')
        .map(id => Number(id));

    if (chatHistoryIds.length === 0) {
        return;
    }

    const historyPlaceholders = chatHistoryIds.map(() => '?').join(',');

    const transaction = db.transaction((): void => {
        const updateStmt = db.prepare(`UPDATE chat_history
                                       SET is_compacted = 0
                                       WHERE id IN (${historyPlaceholders})`);
        updateStmt.run(...chatHistoryIds);

        const deleteStmt = db.prepare(`DELETE
                                       FROM session_wiki
                                       WHERE id = ?`);
        deleteStmt.run(wikiId);
    });

    transaction();
}

// 清空指定会话的数据
export function clearSession(): void {
    const deleteHistory = db.prepare(`DELETE
                                      FROM chat_history
                                      WHERE session_id = ?`);
    const deleteWiki = db.prepare(`DELETE
                                   FROM session_wiki
                                   WHERE session_id = ?`);
    const deleteSession = db.prepare(`DELETE
                                      FROM sessions
                                      WHERE id = ?`);

    const transaction = db.transaction((): void => {
        deleteHistory.run(sessionId);
        deleteWiki.run(sessionId);
        deleteSession.run(sessionId);
    });

    transaction();
}

// 创建新会话
export function createSessionRecord(): void {
    db.prepare(`INSERT INTO sessions DEFAULT
                VALUES`).run();
}

// 更新旧会话的时间
export function touchSessionRecord(oldSessionId: number): void {
    const updateStmt = db.prepare(`UPDATE sessions
                                   SET created_at = CURRENT_TIMESTAMP
                                   WHERE id = ?`);
    const result = updateStmt.run(oldSessionId);

    if (result.changes === 0) {
        throw Error(`无法切换会话，ID: ${oldSessionId} 不存在`);
    }
}

// 查询所有会话
export function listSessions(): session[] {
    const stmt = db.prepare(`SELECT id, created_at
                             FROM sessions
                             ORDER BY created_at DESC`);
    return stmt.all() as session[];
}
