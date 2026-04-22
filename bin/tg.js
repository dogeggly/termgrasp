import {program} from "commander";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

program
    .name('tg')
    .description('TermGrasp - 你的本地终端极客助手')
    .version('1.0.0');

// 定义 why 命令
program
    .command('why')
    .description('分析剪贴板里的终端报错')
    .action(async () => {
        const scriptPath = path.join(__dirname, '../dist/client/why.js');

        if (!fs.existsSync(scriptPath)) {
            console.error('未找到构建产物，请先执行 npm run build');
            process.exit(1);
        }

        try {
            const fileUrl = pathToFileURL(scriptPath).href;
            await import(fileUrl);
        } catch (err) {
            console.error('执行失败:', err.message);
            process.exit(1);
        }
    });

program.parse();

/*
const command = process.argv[2];

if (command === 'why') {
    // 相当于帮你隐式执行了 tsx src/client/why.ts
    const scriptPath = path.join(__dirname, '../src/client/why.ts');

    const result = spawnSync('tsx', [scriptPath], {stdio: 'inherit', shell: true});

    if (result.error) {
        console.error(`执行失败: ${result.error.message}`);
        process.exit(1);
    }
} else {
    console.log('未知的指令，支持的指令：tg why');
}
*/
