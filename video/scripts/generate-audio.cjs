const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const audioDir = path.join(__dirname, '../audio');
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

const scenes = [
  {
    id: 'scene1',
    en: 'Your AI agent made the build green. You never checked how.',
    ru: 'Твой AI-ассистент сделал билд зелёным. Но ты не проверял, как именно.'
  },
  {
    id: 'scene2',
    en: 'It skipped failing tests, slapped as any over your types, and panicked in eight rapid commits.',
    ru: 'Оно скипнуло тесты, заглушило типы через as any, и устроило паник-луп из восьми коммитов.'
  },
  {
    id: 'scene3',
    en: 'Meet agent-roast. An offline git discipline auditor that runs in under two hundred milliseconds.',
    ru: 'Это agent-roast. Оффлайн-аудитор дисциплины в git, который работает быстрее двухсот миллисекунд.'
  },
  {
    id: 'scene4',
    en: 'It scores discipline from zero to one hundred with line proofs, and blocks silent shortcuts in pull requests.',
    ru: 'Он оценивает дисциплину коммитов с доказательствами строк, и блокирует скрытые шорткаты в pull request.'
  },
  {
    id: 'scene5',
    en: 'Audit your repository now with npx agent-roast. Open source on GitHub.',
    ru: 'Проверь свой репозиторий прямо сейчас через npx agent-roast. Опенсорс на GitHub.'
  }
];

function generate(lang, voice, rate) {
  for (const scene of scenes) {
    const text = scene[lang];
    const aiffPath = path.join(audioDir, `${scene.id}_${lang}.aiff`);
    const wavPath = path.join(audioDir, `${scene.id}_${lang}.wav`);
    const m4aPath = path.join(audioDir, `${scene.id}_${lang}.m4a`);
    
    console.log(`Generating ${scene.id} [${lang}]...`);
    execSync(`say -v "${voice}" -r ${rate} "${text.replace(/"/g, '\\"')}" -o "${aiffPath}"`);
    execSync(`afconvert -f WAVE -d LEI16 "${aiffPath}" "${wavPath}"`);
    execSync(`afconvert -f m4af -d aac "${aiffPath}" "${m4aPath}"`);
    fs.unlinkSync(aiffPath);
  }
}

console.log('Generating English voiceover (Daniel)...');
generate('en', 'Daniel', 170);

console.log('Generating Russian voiceover (Milena)...');
generate('ru', 'Milena', 180);

console.log('Done generating voiceover tracks!');
