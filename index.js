const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const STATE_FILE = '.pipeline_state.json';
const OUTPUT_BASE = './output';
const INPUT_DIR = './input';
const CONFIG_FILE = './contest_config.json';

const ALLOWED_TYPES = ['pair', 'single', 'reg_club', 'event'];
const SUPPORTED_TYPES = ['pair'];

let nominations = [];

function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    return {};
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function isNominationComplete(nomination) {
    const resultFile = path.join(OUTPUT_BASE, nomination, 'votes_results.json');
    const reportFile = path.join(OUTPUT_BASE, nomination, 'public_report.json');
    return fs.existsSync(resultFile) || fs.existsSync(reportFile);
}

function getPendingNominations() {
    const pending = new Set();
    let inputNominations = [];
    if (fs.existsSync(INPUT_DIR)) {
        inputNominations = fs.readdirSync(INPUT_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => path.basename(f, '.json'));
    }
    let outputNominations = [];
    if (fs.existsSync(OUTPUT_BASE)) {
        outputNominations = fs.readdirSync(OUTPUT_BASE)
            .filter(item => fs.statSync(path.join(OUTPUT_BASE, item)).isDirectory());
    }
    for (const nom of inputNominations) {
        if (!outputNominations.includes(nom)) {
            pending.add(nom);
        } else if (!isNominationComplete(nom)) {
            pending.add(nom);
        }
    }
    for (const nom of outputNominations) {
        if (!isNominationComplete(nom)) {
            pending.add(nom);
        }
    }
    return Array.from(pending).sort();
}

function generateConfigTemplate() {
    if (!fs.existsSync(INPUT_DIR)) {
        console.error(`❌ Папка ${INPUT_DIR} не существует. Создайте её и положите туда JSON-файлы с комментариями.`);
        process.exit(1);
    }
    const files = fs.readdirSync(INPUT_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        console.error(`❌ В папке ${INPUT_DIR} нет JSON-файлов. Добавьте хотя бы один файл с комментариями.`);
        process.exit(1);
    }
    const template = {};
    for (const file of files) {
        const nom = path.basename(file, '.json');
        template[nom] = { name: "", limit: 0, type: "" };
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(template, null, 2), 'utf8');
    console.log(`✅ Создан шаблон конфигурации: ${CONFIG_FILE}`);
    console.log(`📝 Отредактируйте его, заполнив поля "name", "limit" и "type" для каждой номинации.`);
    console.log(`   Допустимые типы: ${ALLOWED_TYPES.join(', ')}. На данный момент поддерживается только тип "pair".`);
    console.log(`   Затем запустите node pipeline.js снова.`);
}

function validateConfig(config) {
    if (!fs.existsSync(INPUT_DIR)) return true;
    const files = fs.readdirSync(INPUT_DIR).filter(f => f.endsWith('.json'));
    const missing = [];
    const invalid = [];
    for (const file of files) {
        const nom = path.basename(file, '.json');
        const entry = config[nom];
        if (!entry) {
            missing.push(nom);
            continue;
        }
        if (typeof entry.limit !== 'number' || entry.limit <= 0) {
            invalid.push(`${nom}: limit должен быть положительным числом (сейчас ${entry.limit})`);
        }
        if (!entry.type || typeof entry.type !== 'string' || entry.type.trim() === '') {
            invalid.push(`${nom}: type не может быть пустым`);
        } else if (!ALLOWED_TYPES.includes(entry.type)) {
            invalid.push(`${nom}: type "${entry.type}" не входит в список разрешённых (${ALLOWED_TYPES.join(', ')})`);
        } else if (!SUPPORTED_TYPES.includes(entry.type)) {
            console.warn(`⚠️ Номинация "${nom}" имеет тип "${entry.type}", который пока не поддерживается. Она будет пропущена.`);
        }
        if (!entry.name || typeof entry.name !== 'string' || entry.name.trim() === '') {
            invalid.push(`${nom}: name не может быть пустым`);
        }
    }
    if (missing.length > 0) {
        console.error(`❌ В конфиге отсутствуют записи для номинаций: ${missing.join(', ')}`);
        console.error(`   Добавьте их в ${CONFIG_FILE}.`);
        return false;
    }
    if (invalid.length > 0) {
        console.error(`❌ В конфиге найдены некорректные значения:`);
        invalid.forEach(msg => console.error(`   ${msg}`));
        console.error(`   Исправьте их и запустите пайплайн снова.`);
        return false;
    }
    return true;
}

function runScript(scriptName) {
    console.log(`\n🚀 Запуск ${scriptName}...`);
    try {
        execSync(`node ${scriptName}`, { stdio: 'inherit' });
        console.log(`✅ ${scriptName} завершён.\n`);
        return true;
    } catch (err) {
        console.error(`❌ Ошибка при выполнении ${scriptName}:`, err.message);
        return false;
    }
}

// ---- Проверки наличия ручных файлов ----
function checkManualFile(nomination) {
    const manualFile = path.join(OUTPUT_BASE, nomination, 'votes_with_manual.json');
    return fs.existsSync(manualFile);
}

function checkSynonymsFile(nomination) {
    const synonymsFile = path.join(OUTPUT_BASE, nomination, 'synonyms.json');
    return fs.existsSync(synonymsFile);
}

function waitForManualFiles(missingNominations) {
    console.log(`\n✋ Для продолжения необходимо создать файлы votes_with_manual.json для следующих номинаций:`);
    missingNominations.forEach(nom => console.log(`   - ${nom}`));
    console.log(`\n   Для КАЖДОЙ из перечисленных номинаций скопируйте votes.json в votes_with_manual.json в папке:`);
    console.log(`   ${path.join(OUTPUT_BASE, 'ИМЯ_НОМИНАЦИИ')}`);
    console.log(`   Если есть нераспознанные комментарии, отредактируйте их, добавив "withManual": "cleanedText" или "notPairs".`);
    console.log(`   Если нераспознанных нет, просто скопируйте файл без изменений.`);
    console.log(`   Затем перезапустите pipeline.js.`);
    process.exit(0);
}

function waitForSynonymsFiles(missingNominations) {
    console.log(`\n✋ Для продолжения необходимо создать файлы synonyms.json для следующих номинаций:`);
    missingNominations.forEach(nom => console.log(`   - ${nom}`));
    console.log(`\n   На основе unique_pairs.json создайте synonyms.json в папке каждой из перечисленных номинаций:`);
    console.log(`   ${path.join(OUTPUT_BASE, 'ИМЯ_НОМИНАЦИИ')}`);
    console.log(`   Сгруппируйте варианты пар вручную. Затем перезапустите pipeline.js.`);
    process.exit(0);
}

async function main() {
    // ---- Конфиг ----
    if (!fs.existsSync(CONFIG_FILE)) {
        console.log('🔧 Файл конфигурации не найден. Создаю шаблон...');
        generateConfigTemplate();
        console.log('\n✨ После заполнения конфига запустите pipeline.js ещё раз.');
        process.exit(0);
    }
    let globalConfig;
    try {
        globalConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (err) {
        console.error(`❌ Ошибка чтения ${CONFIG_FILE}: ${err.message}`);
        process.exit(1);
    }
    if (!validateConfig(globalConfig)) process.exit(1);

    // ---- Список номинаций к обработке ----
    let pending = getPendingNominations();
    if (pending.length === 0) {
        console.log('✅ Нет новых или незавершённых номинаций.');
        process.exit(0);
    }
    const supported = pending.filter(nom => SUPPORTED_TYPES.includes(globalConfig[nom]?.type));
    const skipped = pending.filter(nom => !SUPPORTED_TYPES.includes(globalConfig[nom]?.type));
    if (skipped.length) console.log(`⚠️ Пропущены номинации с неподдерживаемым типом: ${skipped.join(', ')}`);
    if (supported.length === 0) {
        console.log('✅ Нет номинаций с поддерживаемым типом.');
        process.exit(0);
    }
    nominations = supported;
    console.log(`📋 Обрабатываются номинации: ${nominations.join(', ')}`);

    // ---- Загрузка состояния (глобальный этап) ----
    let state = loadState();
    let currentStage = state.stage || 'parseVotes';

    // ---- Этап 1: parseVotes ----
    if (currentStage === 'parseVotes') {
        if (!runScript('parseVotes.js')) process.exit(1);
        currentStage = 'extractPairs';
        saveState({ stage: currentStage });
    }

    // ---- Этап 2: extractPairs (первичный) ----
    if (currentStage === 'extractPairs') {
        if (!runScript('extractPairs.js')) process.exit(1);
        currentStage = 'manualPairs';
        saveState({ stage: currentStage });
    }

    // ---- Этап 3: manualPairs – ожидание votes_with_manual.json для всех номинаций ----
    if (currentStage === 'manualPairs') {
        const missingManual = nominations.filter(nom => !checkManualFile(nom));
        if (missingManual.length > 0) {
            waitForManualFiles(missingManual);
        }
        // Все ручные файлы есть – запускаем extractPairs.js повторно (он применит правки)
        if (!runScript('extractPairs.js')) process.exit(1);
        currentStage = 'extractUniquePairs';
        saveState({ stage: currentStage });
    }

    // ---- Этап 4: extractUniquePairs ----
    if (currentStage === 'extractUniquePairs') {
        if (!runScript('extractUniquePairs.js')) process.exit(1);
        currentStage = 'manualSynonyms';
        saveState({ stage: currentStage });
    }

    // ---- Этап 5: manualSynonyms – ожидание synonyms.json для всех номинаций ----
    if (currentStage === 'manualSynonyms') {
        const missingSynonyms = nominations.filter(nom => !checkSynonymsFile(nom));
        if (missingSynonyms.length > 0) {
            waitForSynonymsFiles(missingSynonyms);
        }
        currentStage = 'countVotesWithSynonyms';
        saveState({ stage: currentStage });
    }

    // ---- Этап 6: countVotesWithSynonyms и финал ----
    if (currentStage === 'countVotesWithSynonyms') {
        if (!runScript('countVotesWithSynonyms.js')) process.exit(1);
        if (fs.existsSync('generateReport.js')) runScript('generateReport.js');
        console.log('\n🎉 Пайплайн успешно завершён!');
        if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    }
}

main().catch(console.error);