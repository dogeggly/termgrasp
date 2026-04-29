import {clearSession, createSessionRecord} from "./db.js";

clearSession();
createSessionRecord();
console.log('已清空当前会话的历史记录并进入新会话');
