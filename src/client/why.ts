import net from 'node:net';
import {SOCKET_PATH} from "../share/socket.js";
import type Payload from "../share/payload.js";
import clipboard from "clipboardy";

// 发起连接
const client: net.Socket = net.createConnection(SOCKET_PATH, (): void => {
    // 组装要发送给 Server 的指令数据
    const errorLog: string = clipboard.readSync();
    if (!errorLog || !errorLog.trim()) {
        console.log('剪贴板是空的，请先用鼠标选中一下终端里的报错信息哦！');
        client.end();
        return;
    }

    const payload: Payload = {
        action: 'why',
        errorLog: errorLog
    };

    // 发送数据，并加上换行符作为一条消息的结束标志
    client.write(JSON.stringify(payload) + '\n');
});

let newlineStreak: number = 0;

// 接收 Server 发回的流式数据
client.on('data', (data: Buffer): void => {
    // 这里把 Server 返回的分析结果打印到屏幕上
    let chunk: string = data.toString();

    const normalized: string = chunk
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');

    for (const char of normalized) {
        if (char === '\n') {
            newlineStreak += 1;
            if (newlineStreak <= 1) {
                process.stdout.write('\n');
            }
            continue;
        }
        newlineStreak = 0;
        process.stdout.write(char);
    }
});

client.on('end', (): void => {
    console.log('\n连接结束');
})

client.on('error', (err: NodeJS.ErrnoException): void => {
    // 常见错误码：ENOENT（文件或路径不存在，通常是 .sock 文件没找到），ECONNREFUSED（连接被拒绝，Server 没有在监听），EACCES（权限不足，无法访问 .sock 文件）
    if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED' || err.code === 'EACCES') {
        console.error('连接失败: 未找到后台服务。请先启动 TermGrasp Server！');
    } else {
        console.error('连接发生错误:', err.message);
    }
});