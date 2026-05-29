const fs = require('fs');
const path = require('path');
const {
    buildSurnameMap,
    normalizePair
} = require('./pairNormalizer.js');

const OUTPUT_BASE = './output';

function processNomination(nominationPath, nominationName) {
    const pairsFile = path.join(nominationPath, 'votes_with_pairs.json');
    if (!fs.existsSync(pairsFile)) {
        console.log(`  ${nominationName}: votes_with_pairs.json не найден, пропускаем`);
        return;
    }

    const votesData = JSON.parse(fs.readFileSync(pairsFile, 'utf8'));
    const surnameMap = buildSurnameMap(votesData);
    fs.writeFileSync(path.join(nominationPath, 'surname_map.json'), JSON.stringify(
        Object.fromEntries([...surnameMap.entries()].map(([k, v]) => [k, { mostFrequent: v.mostFrequent, variants: [...v.variants.keys()] }])),
        null, 2), 'utf8');

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