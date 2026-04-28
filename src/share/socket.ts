import os from "node:os";

// 获取通信路径（必须和 Server 保持绝对一致）
const SOCKET_PATH = os.platform() === 'win32'
    ? '\\\\.\\pipe\\termgrasp-ipc'
    : '/tmp/termgrasp.sock';

export default SOCKET_PATH;