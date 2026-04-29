import {getFullHistory, getWiki} from "./db.js";
import {marked} from "marked";
import TerminalRenderer from "marked-terminal";

const wiki = getWiki();
const recentHistory = getFullHistory();

const recentHistoryRows = recentHistory.map(item => `|${item.id}|${item.content}|`).join('\n');
const wikiRows = wiki.map(item => `|${item.id}|${item.title}|${item.detail_md}|`).join('\n');

// 配置 marked 使用 TerminalRenderer
marked.setOptions({
    renderer: new TerminalRenderer() as any
});

console.log(marked(`
## 当前会话的历史记录
| ID | 会话 ID | 内容 | 是否被压缩 | 创建时间 |
|---|---|---|---|---|
${recentHistoryRows}

## 当前会话压缩后的Wiki目录
| ID | 会话 ID | 标题 | 详情 | 关联的历史记录 | 创建时间 |
|---|---|---|---|---|---|
${wikiRows}
`))
