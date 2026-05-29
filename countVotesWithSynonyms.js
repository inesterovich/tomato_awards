const fs = require('fs');
const path = require('path');
const { buildSurnameMap, normalizePair } = require('./pairNormalizer.js');

const OUTPUT_BASE = './output';

function processNomination(nominationPath, nominationName) {
    const pairsFile = path.join(nominationPath, 'votes_with_pairs.json');
    const synonymsFile = path.join(nominationPath, 'synonyms.json');
    const uniquePairsFile = path.join(nominationPath, 'unique_pairs.json');

    if (!fs.existsSync(pairsFile)) {
        console.log(`  ${nominationName}: votes_with_pairs.json не найден, пропускаем`);
        return;
    }
    if (!fs.existsSync(synonymsFile)) {
        console.error(`  ${nominationName}: Файл synonyms.json не найден. Сначала создайте его вручную на основе unique_pairs.json`);
        return;
    }
    if (!fs.existsSync(uniquePairsFile)) {
        console.error(`  ${nominationName}: unique_pairs.json не найден. Сначала запустите extractUniquePairs.js`);
        return;
    }

    const votesData = JSON.parse(fs.readFileSync(pairsFile, 'utf8'));
    const synonyms = JSON.parse(fs.readFileSync(synonymsFile, 'utf8'));
    const uniquePairs = JSON.parse(fs.readFileSync(uniquePairsFile, 'utf8'));

    // Строим карту вариант → каноническая пара (включая сам canonical)
    const variantToCanonical = new Map();
    for (const group of synonyms) {
        if (!group.canonical || !group.variants || !Array.isArray(group.variants)) {
            console.error(`  ${nominationName}: Некорректная запись в synonyms.json:`, group);
            process.exit(1);
        }
        variantToCanonical.set(group.canonical, group.canonical);
        for (const variant of group.variants) {
            if (variantToCanonical.has(variant)) {
                console.warn(`  ${nominationName}: Вариант "${variant}" приписан к нескольким каноническим парам. Будет использован первый.`);
                continue;
            }
            variantToCanonical.set(variant, group.canonical);
        }
    }

    // Проверка покрытия: каждый canonical из unique_pairs.json должен присутствовать как вариант или как canonical
    const uncovered = [];
    for (const item of uniquePairs) {
        const canonicalFromFile = item.canonical;
        if (!variantToCanonical.has(canonicalFromFile)) {
            uncovered.push(canonicalFromFile);
        }
    }
    if (uncovered.length > 0) {
        const outUncovered = path.join(nominationPath, 'uncovered_variants.json');
        fs.writeFileSync(outUncovered, JSON.stringify(uncovered, null, 2), 'utf8');
        console.error(`  ${nominationName}: ❌ Найдено ${uncovered.length} вариантов из unique_pairs.json, которые не покрыты synonyms.json.`);
        console.error(`     Сохранено в ${outUncovered}. Добавьте их в synonyms.json (как канонические или варианты).`);
        return;
    }

    // Строим карту фамилий (для нормализации)
    const surnameMap = buildSurnameMap(votesData);

    // Группировка голосов по пользователям
    const userVotesMap = new Map();
    for (const vote of votesData) {
        if (!vote.pairs || vote.pairs.length === 0) continue;
        const userId = vote.userId;
        const timestamp = vote.timestamp;
        const originalText = vote.originalText;
        for (const p of vote.pairs) {
            const normalized = normalizePair(p.pairLeft, p.pairRight, surnameMap);
            const canonical = variantToCanonical.get(normalized);
            if (!canonical) {
                console.warn(`  ${nominationName}: Вариант "${normalized}" не найден в synonyms.json. Пропускаем.`);
                continue;
            }
            if (!userVotesMap.has(userId)) userVotesMap.set(userId, []);
            userVotesMap.get(userId).push({
                canonical,
                timestamp,
                originalText,
                pairRaw: p.pairRaw,
                userId,
                username: vote.username
            });
        }
    }

    // Лимит 3 голоса на пользователя
    const allVotes = [];
    for (const [userId, items] of userVotesMap.entries()) {
        items.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const counted = items.slice(0, 3);
        const uncounted = items.slice(3);
        for (const item of counted) allVotes.push({ ...item, counted: true });
        for (const item of uncounted) allVotes.push({ ...item, counted: false });
    }

    // Агрегация по каноническим парам
    const pairStats = new Map();
    for (const vote of allVotes) {
        const canonical = vote.canonical;
        if (!pairStats.has(canonical)) pairStats.set(canonical, { votes: [], uncounted: [] });
        const entry = pairStats.get(canonical);
        const voteInfo = {
            userId: vote.userId,
            username: vote.username,
            timestamp: vote.timestamp,
            comment: vote.originalText,
            rawPair: vote.pairRaw
        };
        if (vote.counted) entry.votes.push(voteInfo);
        else entry.uncounted.push(voteInfo);
    }

    const results = Array.from(pairStats.entries()).map(([pair, data]) => ({
        pair,
        total_votes: data.votes.length,
        total_uncounted: data.uncounted.length,
        votes: data.votes,
        uncounted_votes: data.uncounted
    }));
    results.sort((a, b) => b.total_votes - a.total_votes);

    const outFile = path.join(nominationPath, 'votes_results.json');
    fs.writeFileSync(outFile, JSON.stringify({
        nomination: nominationName,
        total_unique_voters: userVotesMap.size,
        total_votes_submitted: allVotes.length,
        total_votes_counted: allVotes.filter(v => v.counted).length,
        total_votes_uncounted: allVotes.filter(v => !v.counted).length,
        pairs: results
    }, null, 2), 'utf8');

    console.log(`  ${nominationName}:`);
    console.log(`    Уникальных пользователей: ${userVotesMap.size}`);
    console.log(`    Всего голосов (после маппинга): ${allVotes.length}`);
    console.log(`    Зачтено: ${allVotes.filter(v => v.counted).length}, отклонено (лимит 3): ${allVotes.filter(v => !v.counted).length}`);
    console.log(`    Уникальных пар: ${results.length}`);
    console.log(`    Результат сохранён в ${outFile}`);
}

function main() {
    if (!fs.existsSync(OUTPUT_BASE)) {
        console.error(`Папка ${OUTPUT_BASE} не существует. Сначала запустите parseVotes.js и extractPairs.js`);
        process.exit(1);
    }
    const nominations = fs.readdirSync(OUTPUT_BASE).filter(item => {
        const itemPath = path.join(OUTPUT_BASE, item);
        return fs.statSync(itemPath).isDirectory();
    });
    if (nominations.length === 0) {
        console.log(`Нет папок номинаций в ${OUTPUT_BASE}`);
        return;
    }
    console.log(`Найдено номинаций: ${nominations.length}\n`);
    for (const nom of nominations) {
        const nomPath = path.join(OUTPUT_BASE, nom);
        processNomination(nomPath, nom);
        console.log('');
    }
    console.log('Готово!');
}

main();