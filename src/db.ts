import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {fileURLToPath} from "url";
import * as sqliteVec from "sqlite-vec";
import {getEmbedding} from "./share.js";

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

sqliteVec.load(db);

// 4. 查询会话
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

export interface ChatHistory {
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

interface Wiki {
    id: number;
    session_id: number;
    title: string;
    detail_md: string;
    created_at: string;
}

interface Session {
    id: number;
    created_at: string;
}

export type LLMPrompt<T, K extends keyof T> = { [P in K]: T[P] };

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
                               AND is_compacted = 0
                             order by created_at desc`);
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
export async function saveWiki(
    chatHistoryIds: number[],
    wikiTitles: string[],
    wikiDetails: string[]
): Promise<void> {
    const historyPlaceholders = chatHistoryIds.map(() => '?').join(',');
    const chatIds = chatHistoryIds.join(',');

    const insertSessionWikiStmt = db.prepare(`INSERT INTO session_wiki (session_id, title, detail_md, chat_ids)
                                              VALUES (?, ?, ?, ?)`);
    const insertGlobalWikiStmt = db.prepare(`INSERT INTO wiki (session_id, title, detail_md)
                                             VALUES (?, ?, ?)`);
    const insertVecStmt = db.prepare(`INSERT INTO vec_memories (rowid, embedding)
                                      VALUES (?, ?)`);
    const updateStmt = db.prepare(`UPDATE chat_history
                                   SET is_compacted = 1
                                   WHERE id IN (${historyPlaceholders})`);

    const embeddings = await Promise.all(wikiTitles.map((title) => getEmbedding(title)));

    const saveWithEmbeddings = db.transaction((): void => {
        for (let i = 0; i < wikiTitles.length; i++) {
            insertSessionWikiStmt.run(sessionId, wikiTitles[i], wikiDetails[i], chatIds);
            const res = insertGlobalWikiStmt.run(sessionId, wikiTitles[i], wikiDetails[i]);
            const embedding = embeddings[i];
            if (!embedding) throw Error(`缺失 embedding 数据，无法保存向量记忆。标题: ${wikiTitles[i]}`);
            const float32Embedding = new Float32Array(embedding);
            insertVecStmt.run(res.lastInsertRowid, float32Embedding);
        }
        updateStmt.run(...chatHistoryIds);
    });

    saveWithEmbeddings();
}

// 还原压缩后的对话（将 Wiki 详情重新插入短期记忆）
export function restoreCompactedHistory(wikiId: number): void {
    const wikiStmt = db.prepare(`SELECT chat_ids
                                 FROM session_wiki
                                 WHERE id = ?`);
    const wikiRow = wikiStmt.get(wikiId) as { chat_ids: string } | null;

    if (!wikiRow) throw Error('不存在此 Wiki 项')

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
export function listSessions(): Session[] {
    const stmt = db.prepare(`SELECT id, created_at
                             FROM sessions
                             ORDER BY created_at DESC`);
    return stmt.all() as Session[];
}

// 按照向量相似度查询，并过滤掉当前 Session 的记录
export function queryVecMemories(embedding: number[]): LLMPrompt<Wiki, 'id' | 'title' | 'detail_md'>[] {
    const float32Embedding = new Float32Array(embedding);
    // 获取 vec_memories 记录及其对应的 rowId
    const wikiStmt = db.prepare(`SELECT w.id, w.session_id, w.title, w.detail_md, v.distance
                                 FROM vec_memories v
                                          JOIN wiki w ON w.id = v.rowid
                                 WHERE v.embedding MATCH ? -- 传入当前问题的 embedding
                                 ORDER BY v.distance
                                 LIMIT 5;`);
    const wikiRecords = wikiStmt.all(float32Embedding) as {
        id: number;
        session_id: number;
        title: string;
        detail_md: string;
        distance: number; // 计算得到的距离值
    }[];

    const RAG_THRESHOLD = 0.8; // 距离越小越相似，超过阈值说明没有相关记忆
    return wikiRecords.filter(wiki => wiki.distance < RAG_THRESHOLD)
        .filter(wiki => wiki.session_id !== sessionId);
}
