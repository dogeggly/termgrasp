import fs from "node:fs";
import os from "node:os";
import {cleanup, server, SOCKET_PATH} from "./server/server.js";

const serverStart = (): void => {
    // 核心防御机制：启动前清理僵尸 Socket
    // 如果上一次进程异常崩溃，.sock 文件会遗留，导致 EADDRINUSE 错误
    // 测试环境下只是停止了 tsx，其子进程会被 tsx 强杀，触发不了
    if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
        console.log(`发现遗留的 Socket 文件，正在清理...`);
        fs.unlinkSync(SOCKET_PATH);
    }

    // 启动监听
    server.listen(SOCKET_PATH, (): void => {
        console.log(`守护进程已启动，正在监听 ${SOCKET_PATH}`);
    });

    process.on('SIGINT', cleanup);  // 捕获 2 信号，即 Ctrl+C
    process.on('SIGTERM', cleanup); // 捕获 15 信号，即 kill 命令
}

serverStart()
