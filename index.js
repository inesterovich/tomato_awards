const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const STATE_FILE = '.pipeline_state.json';
const OUTPUT_BASE = './output';

// Список номинаций (можно определить автоматически, но лучше передать аргументом)
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

function getNominations() {
    if (!fs.existsSync(OUTPUT_BASE)) return [];
    return fs.readdirSync(OUTPUT_BASE).filter(item => {
        const itemPath = path.join(OUTPUT_BASE, item);
        return fs.statSync(itemPath).isDirectory();
    });
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

function checkUnrecognized(nomination) {
    const unrecognizedFile = path.join(OUTPUT_BASE, nomination, 'votes_unrecognized.json');
    if (!fs.existsSync(unrecognizedFile)) return false;
    const data = JSON.parse(fs.readFileSync(unrecognizedFile, 'utf8'));
    return data.length > 0;
}

function checkManualFile(nomination) {
    const manualFile = path.join(OUTPUT_BASE, nomination, 'votes_with_manual.json');
    return fs.existsSync(manualFile);
}

function checkSynonymsFile(nomination) {
    const synonymsFile = path.join(OUTPUT_BASE, nomination, 'synonyms.json');
    return fs.existsSync(synonymsFile);
}

function waitForManualFile(nomination) {
    console.log(`\n✋ Номинация "${nomination}": обнаружены нераспознанные комментарии.`);
    console.log(`   Чтобы продолжить, создайте файл votes_with_manual.json в папке ${path.join(OUTPUT_BASE, nomination)}`);
    console.log(`   Скопируйте туда votes.json и отредактируйте нераспознанные записи, добавив "withManual": "cleanedText" или "notPairs".`);
    console.log(`   Затем перезапустите pipeline.js.`);
    process.exit(0);
}

function waitForSynonymsFile(nomination) {
    console.log(`\n✋ Номинация "${nomination}": требуется ручное создание synonyms.json.`);
    console.log(`   На основе unique_pairs.json создайте synonyms.json в папке ${path.join(OUTPUT_BASE, nomination)}`);
    console.log(`   Сгруппируйте варианты пар вручную. Затем перезапустите pipeline.js.`);
    process.exit(0);
}

async function main() {
    nominations = getNominations();
    if (nominations.length === 0) {
        console.error('Нет номинаций в папке output. Сначала запустите parseVotes.js вручную?');
        process.exit(1);
    }

    const state = loadState();
    // Для простоты будем обрабатывать все номинации последовательно, но состояние глобальное.
    // Можно хранить этап для каждой номинации, но для упрощения считаем, что все номинации проходят этапы синхронно.
    let currentStage = state.stage || 'parseVotes';

    if (currentStage === 'parseVotes') {
        if (runScript('parseVotes.js')) {
            currentStage = 'extractPairs';
            saveState({ stage: currentStage });
        } else {
            console.error('Ошибка на этапе parseVotes. Исправьте и запустите снова.');
            process.exit(1);
        }
    }

    if (currentStage === 'extractPairs') {
        if (runScript('extractPairs.js')) {
            // Проверим, есть ли нераспознанные комментарии хотя бы в одной номинации
            let hasUnrecognized = false;
            for (const nom of nominations) {
                if (checkUnrecognized(nom)) {
                    hasUnrecognized = true;
                    break;
                }
            }
            if (hasUnrecognized) {
                currentStage = 'manualPairs';
                saveState({ stage: currentStage });
                // Остановка для ручного вмешательства
                waitForManualFile(nominations.find(nom => checkUnrecognized(nom)) || nominations[0]);
            } else {
                currentStage = 'extractUniquePairs';
                saveState({ stage: currentStage });
            }
        } else {
            console.error('Ошибка на этапе extractPairs. Исправьте и запустите снова.');
            process.exit(1);
        }
    }

    if (currentStage === 'manualPairs') {
        // Проверяем, появился ли ручной файл хотя бы в одной номинации (теоретически во всех, но допустим)
        let manualExists = false;
        for (const nom of nominations) {
            if (checkManualFile(nom)) {
                manualExists = true;
                break;
            }
        }
        if (!manualExists) {
            waitForManualFile(nominations.find(nom => checkUnrecognized(nom)) || nominations[0]);
        }
        // Запускаем extractPairs.js снова (он сам обработает ручной файл)
        if (runScript('extractPairs.js')) {
            currentStage = 'extractUniquePairs';
            saveState({ stage: currentStage });
        } else {
            console.error('Ошибка при повторном запуске extractPairs.js. Проверьте ручные файлы.');
            process.exit(1);
        }
    }

    if (currentStage === 'extractUniquePairs') {
        if (runScript('extractUniquePairs.js')) {
            currentStage = 'manualSynonyms';
            saveState({ stage: currentStage });
            // Проверим, есть ли synonyms.json
            let synonymsExist = true;
            for (const nom of nominations) {
                if (!checkSynonymsFile(nom)) {
                    synonymsExist = false;
                    break;
                }
            }
            if (!synonymsExist) {
                waitForSynonymsFile(nominations.find(nom => !checkSynonymsFile(nom)) || nominations[0]);
            } else {
                currentStage = 'countVotesWithSynonyms';
                saveState({ stage: currentStage });
            }
        } else {
            console.error('Ошибка на этапе extractUniquePairs.');
            process.exit(1);
        }
    }

    if (currentStage === 'manualSynonyms') {
        let synonymsExist = true;
        for (const nom of nominations) {
            if (!checkSynonymsFile(nom)) {
                synonymsExist = false;
                break;
            }
        }
        if (!synonymsExist) {
            waitForSynonymsFile(nominations.find(nom => !checkSynonymsFile(nom)) || nominations[0]);
        }
        // Если все synonyms.json есть, переходим к подсчёту
        currentStage = 'countVotesWithSynonyms';
        saveState({ stage: currentStage });
    }

    if (currentStage === 'countVotesWithSynonyms') {
        if (runScript('countVotesWithSynonyms.js')) {
            // Опционально запускаем генерацию отчёта
            if (fs.existsSync('generateReport.js')) {
                runScript('generateReport.js');
            }
            console.log('\n🎉 Пайплайн успешно завершён!');
            // Удаляем состояние, чтобы при следующем запуске начать сначала
            fs.unlinkSync(STATE_FILE);
        } else {
            console.error('Ошибка на этапе подсчёта голосов.');
            process.exit(1);
        }
    }
}

main().catch(console.error);