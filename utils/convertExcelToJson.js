const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const INPUT_FILE = './db/dancers_list.xlsx';
const OUTPUT_DIR = './db/result/';
function transliterate(text) {
    const map = {
        'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e',
        'ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m',
        'н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
        'ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
        'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
        'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'E',
        'Ж':'Zh','З':'Z','И':'I','Й':'Y','К':'K','Л':'L','М':'M',
        'Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T','У':'U',
        'Ф':'F','Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Shch',
        'Ъ':'','Ы':'Y','Ь':'','Э':'E','Ю':'Yu','Я':'Ya'
    };
    return text.replace(/[а-яёА-ЯЁ]/g, match => map[match] || match)
               .replace(/[^a-zA-Z0-9]/g, '_')
               .replace(/_+/g, '_')
               .replace(/^_|_$/g, '');
}

async function convert() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const workbook = new ExcelJS.Workbook();
    console.log('Загрузка файла...');
    await workbook.xlsx.readFile(INPUT_FILE);
    console.log(`Листов: ${workbook.worksheets.length}`);

    for (const worksheet of workbook.worksheets) {
        const sheetName = worksheet.name;
        console.log(`\nОбработка листа: "${sheetName}"`);

        // Находим первую строку с данными (заголовок)
        let headerRow = null;
        let headerRowNumber = 1;
        for (let rowNum = 1; rowNum <= 10; rowNum++) {
            const row = worksheet.getRow(rowNum);
            const hasData = row.cellCount > 0 && row.values.some(cell => cell && cell.toString().trim());
            if (hasData) {
                headerRow = row;
                headerRowNumber = rowNum;
                break;
            }
        }
        if (!headerRow) {
            console.log(`  Лист "${sheetName}" пуст, пропускаем`);
            continue;
        }

        // Получаем заголовки
        const rawHeaders = [];
        headerRow.eachCell((cell, colNumber) => {
            let val = cell.value ? cell.value.toString().trim() : `col_${colNumber}`;
            rawHeaders.push(val);
        });

        // Транслитерируем заголовки
        const headers = rawHeaders.map(h => transliterate(h));
        console.log(`  Заголовки: ${headers.join(', ')}`);

        const outFile = path.join(OUTPUT_DIR, `${sheetName}.json`);
        const writeStream = fs.createWriteStream(outFile);
        writeStream.write('[\n');

        let isFirstRow = true;
        let rowCount = 0;

        // Перебираем строки, начиная со следующей после заголовка
        for (let rowNum = headerRowNumber + 1; rowNum <= worksheet.rowCount; rowNum++) {
            const row = worksheet.getRow(rowNum);
            if (row.cellCount === 0) continue;
            const obj = {};
            let hasData = false;
            for (let i = 0; i < headers.length; i++) {
                const cell = row.getCell(i + 1);
                let val = cell.value;
                if (val && typeof val === 'object') {
                    if (val.result !== undefined) val = val.result;
                    else if (val.text) val = val.text;
                    else if (val.error) val = null;
                }
                if (val !== undefined && val !== null && val !== '') hasData = true;
                obj[headers[i]] = val;
            }
            if (!hasData) continue;

            if (!isFirstRow) writeStream.write(',\n');
            writeStream.write(JSON.stringify(obj));
            isFirstRow = false;
            rowCount++;
            if (rowCount % 5000 === 0) console.log(`    Обработано ${rowCount} строк`);
        }

        writeStream.write('\n]');
        writeStream.end();
        console.log(`  Сохранено ${rowCount} строк в ${outFile}`);
    }

    console.log('\n✅ Конвертация завершена');
}

convert().catch(err => {
    console.error('Ошибка:', err);
    process.exit(1);
});