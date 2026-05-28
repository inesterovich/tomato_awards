import { readFile } from 'fs/promises';



async function parseVoteJson (params) {
    const rawData = await readFile(new URL('./vk-routine_of_the_year.json', import.meta.url));
    const json = JSON.parse(rawData);
    const length = json.length;
    console.log(length);
}

parseVoteJson();