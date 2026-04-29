import {restoreCompactedHistory} from "./db.js";

const wikiIdStr = process.argv[3];
if (!wikiIdStr) {
    throw Error('请提供 Wiki ID，例如: tg restore 3');
}

const wikiId = Number(wikiIdStr);
if (!Number.isFinite(wikiId)) {
    throw Error('请提供有效的 Wiki ID，例如: tg restore 3');
}

restoreCompactedHistory(wikiId);
console.log(`已还原 Wiki ${wikiId} 对应的对话记录`);