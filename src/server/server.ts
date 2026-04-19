import fs from "node:fs";
import net from "node:net";
import os from "node:os";

// 跨平台动态生成 IPC 路径
export const SOCKET_PATH = os.platform() === 'win32'
    ? '\\\\.\\pipe\\termgrasp-ipc' // Windows 命名管道格式 (注意反斜杠转义)
    : '/tmp/termgrasp.sock';       // Unix/Mac 格式

// 创建 UDS Server
export const server = net.createServer((connection: net.Socket): void => {
    console.log('Client 已连接');

    // 监听 Client 发来的数据流
    connection.on('data', (data: string): void => {
        const message = data.toString().trim();
        console.log(`收到 Client 消息: ${message}`);

        connection.write(`Server 收到指令，准备开始分析报错...`);

        // TODO: 模拟处理后，将结果发回给 Client

        // 模拟处理完成，主动断开连接
        connection.end();
    });

    connection.on('end', (): void => {
        console.log('Client 断开连接');
    });

    connection.on('error', (err: Error): void => {
        console.error('连接发生错误:', err);
    });
});

// 优雅停机 (Graceful Shutdown)
// 监听终端的 Ctrl+C 或系统的 kill 信号，退出前必须把本地的 .sock 文件删干净
export const cleanup = (): never => {
    console.log('收到停止信号，正在清理资源并退出...');
    if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
        fs.unlinkSync(SOCKET_PATH);
    }
    process.exit(0);
};
