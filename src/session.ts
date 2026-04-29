import {createSessionRecord, listSessions, touchSessionRecord} from "./db.js";
import {marked} from "marked";
import TerminalRenderer from "marked-terminal";

const session = () => {
    const sessionIdStr = process.argv[3];
    if (!sessionIdStr) {
        createSessionRecord();
        console.log('已创建并进入新会话');
        return;
    }

    if (sessionIdStr === '--ls' || sessionIdStr === '-l') {
        const sessions = listSessions();
        const sessionRows = sessions.map(item => `|${item.id}|${item.created_at}|`).join('\n');
        marked.setOptions({
            renderer: new TerminalRenderer() as any
        });
        console.log(marked(`
## 当前会话的历史记录
| 会话 ID | 创建时间 |
|---|---|
${sessionRows}
`))
        return;
    }

    const sessionId = Number(sessionIdStr);
    if (!Number.isFinite(sessionId)) {
        throw Error('请提供有效的 session ID，例如: tg session 3');
    }

    touchSessionRecord(sessionId);
    console.log(`已切换到会话 ${sessionId}`);
}

session();
