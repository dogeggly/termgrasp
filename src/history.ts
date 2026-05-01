import {getFullHistory, getWiki} from "./db.js";

const wiki = getWiki();
const recentHistory = getFullHistory();

const flattenText = (value: string): string => value.replace(/\r?\n/g, ' ');

const recentHistoryRows = recentHistory
    .map(item => `------------------------------------------------------------------
- ID: ${item.id}\n- 是否被压缩: ${item.is_compacted}\n- 创建时间: ${item.created_at}\n- 内容: ${flattenText(item.content)}`)
    .join('\n');
const wikiRows = wiki
    .map(item => `------------------------------------------------------------------
- ID: ${item.id}\n- 标题: ${item.title}\n- 关联的历史记录: ${item.chat_ids}\n- 创建时间: ${item.created_at}\n- 详情: ${flattenText(item.detail_md)}`)
    .join('\n');

console.log(`
## 当前会话的历史记录
${recentHistoryRows}
------------------------------------------------------------------
## 当前会话压缩后的Wiki目录
${wikiRows}
`)
