import Database from "better-sqlite3";
import {fileURLToPath} from "url";
import path from "path";
import fs from "fs";
import * as sqliteVec from "sqlite-vec";

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
        id
            INTEGER
            PRIMARY
                KEY
            AUTOINCREMENT,
        session_id
            INTEGER, -- 当前会话 ID
        content
            TEXT,    -- 原始对话内容
        is_compacted
            INTEGER
            DEFAULT
                0,   -- 关键：标记该条目是否已被压缩进 Wiki
        created_at
            DATETIME
            DEFAULT
                CURRENT_TIMESTAMP
    );
`);

// 创建长期记忆表 (session_wiki)
db.exec(`
    CREATE TABLE IF NOT EXISTS session_wiki
    (
        id
            INTEGER
            PRIMARY
                KEY
            AUTOINCREMENT,
        session_id
            INTEGER,
        title
            TEXT, -- 对话块的摘要标题
        detail_md
            TEXT, -- 详细的知识点或解决方案
        chat_ids
            TEXT, -- 关联的 chat_history ID 列表（逗号分隔）
        created_at
            DATETIME
            DEFAULT
                CURRENT_TIMESTAMP
    );
`);

// 创建独立的 Wiki 表（wiki），用于存储不依赖于特定会话的知识点，未来可扩展为全局知识库
db.exec(`
    CREATE TABLE IF NOT EXISTS wiki
    (
        id
            INTEGER
            PRIMARY
                KEY
            AUTOINCREMENT,
        session_id
            INTEGER,
        title
            TEXT, -- 对话块的摘要标题
        detail_md
            TEXT, -- 详细的知识点或解决方案
        created_at
            DATETIME
            DEFAULT
                CURRENT_TIMESTAMP
    );
`);

// 创建向量记忆表 (vec_memories)
sqliteVec.load(db);
db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0
    (
        embedding float[1536]
    );
`);

// 创建会话表 (sessions)
db.exec(`
    CREATE TABLE IF NOT EXISTS sessions
    (
        id
            INTEGER
            PRIMARY
                KEY
            AUTOINCREMENT,
        created_at
            DATETIME
            DEFAULT
                CURRENT_TIMESTAMP
    )
`);