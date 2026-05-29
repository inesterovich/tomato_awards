const fs = require('fs');
const path = require('path');

const OUTPUT_BASE = './output';

// ---------- Функции нормализации (идентичны тем, что в countVotes) ----------
function extractFullNames(text) {
    if (!text || typeof text !== 'string') return new Set();
    const pattern = /([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)/g;
    const names = new Set();
    let match;
    while ((match = pattern.exec(text)) !== null) {
        names.add(`${match[1]} ${match[2]}`);
        names.add(`${match[2]} ${match[1]}`);
    }
    return names;
}

function buildSurnameMap(votesData) {
    const surnameStats = new Map();
    const updateStats = (fullName) => {
        const words = fullName.split(' ');
        if (words.length < 2) return;
        const surname = words[words.length - 1].toLowerCase();
        if (!surnameStats.has(surname)) {
            surnameStats.set(surname, { count: 0, fullName: fullName });
        }
        const entry = surnameStats.get(surname);
        entry.count++;
        if (entry.count > (surnameStats.get(surname).count || 0)) {
            entry.fullName = fullName;
        }
    };
    for (const vote of votesData) {
        if (vote.originalText) {
            const names = extractFullNames(vote.originalText);
            for (const fullName of names) updateStats(fullName);
        }
        if (vote.pairs && Array.isArray(vote.pairs)) {
            for (const p of vote.pairs) {
                if (p.pairLeft && typeof p.pairLeft === 'string') {
                    const names = extractFullNames(p.pairLeft);
                    for (const fullName of names) updateStats(fullName);
                }
                if (p.pairRight && typeof p.pairRight === 'string') {
                    const names = extractFullNames(p.pairRight);
                    for (const fullName of names) updateStats(fullName);
                }
            }
        }
    }
    return surnameStats;
}

function normalizeSide(side, surnameMap) {
    const trimmed = side.trim();
    const words = trimmed.split(/\s+/);
    if (words.length === 1) {
        const lower = words[0].toLowerCase();
        if (surnameMap.has(lower)) return surnameMap.get(lower).fullName;
        return trimmed;
    } else {
        const lastWord = words[words.length - 1].toLowerCase();
        if (surnameMap.has(lastWord)) return surnameMap.get(lastWord).fullName;
        const firstWord = words[0].toLowerCase();
        if (surnameMap.has(firstWord)) return surnameMap.get(firstWord).fullName;
        return trimmed;
    }
}

function normalizePair(pairLeft, pairRight, surnameMap) {
    let leftNorm = normalizeSide(pairLeft, surnameMap);
    let rightNorm = normalizeSide(pairRight, surnameMap);
    const getSurname = (name) => name.split(' ').pop().toLowerCase();
    if (getSurname(leftNorm) > getSurname(rightNorm)) {
        [leftNorm, rightNorm] = [rightNorm, leftNorm];
    }
    return `${leftNorm} - ${rightNorm}`;
}
// -----------------------------------------------------------------

function processNomination(nominationPath, nominationName) {
    const pairsFile = path.join(nominationPath, 'votes_with_pairs.json');
    if (!fs.existsSync(pairsFile)) {
        console.log(`  ${nominationName}: votes_with_pairs.json не найден, пропускаем`);
        return;
    }

    const votesData = JSON.parse(fs.readFileSync(pairsFile, 'utf8'));
    const surnameMap = buildSurnameMap(votesData);
    // сохраняем карту для справки (необязательно)
    fs.writeFileSync(path.join(nominationPath, 'surname_map.json'), JSON.stringify(Object.fromEntries(surnameMap), null, 2), 'utf8');

    const uniquePairsSet = new Set();
    for (const vote of votesData) {
        if (!vote.pairs || vote.pairs.length === 0) continue;
        for (const p of vote.pairs) {
            const canonical = normalizePair(p.pairLeft, p.pairRight, surnameMap);
            uniquePairsSet.add(canonical);
        }
    }

    const uniquePairs = Array.from(uniquePairsSet).sort().map(str => ({ canonical: str }));
    const outFile = path.join(nominationPath, 'unique_pairs.json');
    fs.writeFileSync(outFile, JSON.stringify(uniquePairs, null, 2), 'utf8');

    console.log(`  ${nominationName}: найдено уникальных пар: ${uniquePairs.length}`);
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