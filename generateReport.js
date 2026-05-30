const fs = require('fs');
const path = require('path');

const OUTPUT_BASE = './output';
const CONFIG_FILE = './contest_config.json';

// Загрузка конфига (если есть)
function loadConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        console.warn(`⚠️ Файл конфигурации ${CONFIG_FILE} не найден. Будут использованы технические имена номинаций.`);
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (err) {
        console.warn(`⚠️ Ошибка чтения ${CONFIG_FILE}: ${err.message}. Будут использованы технические имена.`);
        return null;
    }
}

// Получить человекочитаемое имя номинации
function getDisplayName(nomination, config) {
    if (config && config[nomination] && config[nomination].name && config[nomination].name.trim() !== '') {
        return config[nomination].name;
    }
    return nomination; // fallback на техническое имя
}

function generateReport() {
    if (!fs.existsSync(OUTPUT_BASE)) {
        console.error(`Папка ${OUTPUT_BASE} не найдена. Сначала запустите основные скрипты.`);
        process.exit(1);
    }

    const config = loadConfig(); // может быть null

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

        const displayName = getDisplayName(nom, config);

        const publicReport = {
            nomination: displayName,          // человекочитаемое название
            technical_name: nom,              // сохраним техническое для справки
            total_voters: totalVoters,
            pairs: pairs
        };

        const outFile = path.join(OUTPUT_BASE, nom, 'public_report.json');
        fs.writeFileSync(outFile, JSON.stringify(publicReport, null, 2), 'utf8');
        console.log(`  ${nom} -> публичный отчёт сохранён в ${outFile}`);

        // Короткий вывод в консоль (первые 5 мест) с человекочитаемым названием
        console.log(`\n🏆 Номинация: ${displayName} (${nom})`);
        console.log(`👥 Всего голосовавших: ${totalVoters}`);
        console.log(`🏅 Результаты (топ-5):`);
        pairs.slice(0, 5).forEach(p => console.log(`   ${p.place}. ${p.pair} — ${p.votes} гол.`));
    }
}

generateReport();