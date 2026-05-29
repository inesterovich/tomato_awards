const fs = require('fs');
const path = require('path');

const OUTPUT_BASE = './output';

function generateReport() {
    if (!fs.existsSync(OUTPUT_BASE)) {
        console.error(`Папка ${OUTPUT_BASE} не найдена. Сначала запустите основные скрипты.`);
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

    for (const nom of nominations) {
        const resultFile = path.join(OUTPUT_BASE, nom, 'votes_results.json');
        if (!fs.existsSync(resultFile)) {
            console.log(`  ${nom}: votes_results.json не найден, пропускаем`);
            continue;
        }

        const fullData = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        const totalVoters = fullData.total_unique_voters;
        const pairs = fullData.pairs.map((p, idx) => ({
            place: idx + 1,
            pair: p.pair,
            votes: p.total_votes
        }));

        const publicReport = {
            nomination: nom,
            total_voters: totalVoters,
            pairs: pairs
        };

        const outFile = path.join(OUTPUT_BASE, nom, 'public_report.json');
        fs.writeFileSync(outFile, JSON.stringify(publicReport, null, 2), 'utf8');
        console.log(`  ${nom}: публичный отчёт сохранён в ${outFile}`);

        // Короткий вывод в консоль (первые 5 мест)
        console.log(`\n🏆 Номинация: ${nom}`);
        console.log(`👥 Всего голосовавших: ${totalVoters}`);
        console.log(`🏅 Результаты (топ-5):`);
        pairs.slice(0, 5).forEach(p => console.log(`   ${p.place}. ${p.pair} — ${p.votes} гол.`));
    }
}

generateReport();