import {cleanup, SOCKET_PATH} from "./share/socket.js";
import {server} from "./server/server.js";


const serverStart = (): void => {
    // 核心防御机制：启动前清理僵尸 Socket
    // 如果上一次进程异常崩溃，.sock 文件会遗留，导致 EADDRINUSE 错误
    cleanup()

    // 启动监听
    server.listen(SOCKET_PATH, (): void => {
        console.log(`守护进程已启动，正在监听 ${SOCKET_PATH}`);
    });

    server.on('error', (err: NodeJS.ErrnoException): void => {
        console.error('守护进程启动失败:', err.message);
    });

    // 优雅停机 (Graceful Shutdown)
    process.on('exit', cleanup); // 执行清理函数，测试环境下只是停止了 tsx，其子进程会被 tsx 强杀，触发不了
    process.on('SIGINT', (): never => process.exit(0));  // 捕获 2 信号，即 Ctrl+C
    process.on('SIGTERM', (): never => process.exit(0)); // 捕获 15 信号，即 kill 命令
}

serverStart()
