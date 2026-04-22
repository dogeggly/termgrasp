import os from "node:os";
import fs from "node:fs";

// 获取通信路径（必须和 Server 保持绝对一致）
export const SOCKET_PATH = os.platform() === 'win32'
    ? '\\\\.\\pipe\\termgrasp-ipc'
    : '/tmp/termgrasp.sock';

export const cleanup = (): void => {
    if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
        console.log('正在清理资源...');
        fs.unlinkSync(SOCKET_PATH);
    }
};