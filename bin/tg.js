import {program} from "commander";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const __filename = fileURLToPath(import.meta.url);

const start = async (scriptPath) => {
    if (!fs.existsSync(scriptPath)) {
        console.error('未找到构建产物，请先执行 npm run build');
        process.exit(1);
    }
    try {
        const fileUrl = pathToFileURL(scriptPath).href;
        await import(fileUrl);
    } catch (err) {
        console.error('执行失败: ', err);
        process.exit(1);
    }
}

program
    .name('tg')
    .description('TermGrasp - 你的本地终端极客助手')
    .version('1.0.0');

program
    .command('why')
    .description('分析剪贴板里的终端信息')
    .option('-m, --message <text>', '补充的对话信息')
    .option('-s, --single', '此次对话不加入会话记录当中')
    .action(async () => {
        const scriptPath = path.join(__filename, '../../dist/why.js');
        await start(scriptPath);
    });

program
    .command('history')
    .description('查看当前会话的历史记录')
    .action(async () => {
        const scriptPath = path.join(__filename, '../../dist/history.js');
        await start(scriptPath);
    });

program
    .command('clear')
    .description('清空当前会话的历史记录，并进入新会话')
    .action(async () => {
        const scriptPath = path.join(__filename, '../../dist/clear.js');
        await start(scriptPath);
    });

program
    .command('compact')
    .description('压缩当前会话的历史记录，生成一个 Wiki')
    .action(async () => {
        const scriptPath = path.join(__filename, '../../dist/compact.js');
        await start(scriptPath);
    });

program
    .command('restore')
    .description('还原压缩后的对话，将 Wiki 详情重新插入短期记忆')
    .argument('[wikiId]', '需要还原的 Wiki ID')
    .action(async () => {
        const scriptPath = path.join(__filename, '../../dist/restore.js');
        await start(scriptPath);
    });

program
    .command('session')
    .description('创建一个新的会话并进入，或进入一个旧会话')
    .argument('[sessionId]', '需要进入的会话 ID')
    .option('-l, --ls', '列出会话列表')
    .action(async (sessionId, options) => {
        if (options?.ls && sessionId) {
            console.error('参数冲突: 不能同时使用 sessionId 和 --ls');
            process.exit(1);
        }
        const scriptPath = path.join(__filename, '../../dist/session.js');
        await start(scriptPath);
    });

program.parse();
