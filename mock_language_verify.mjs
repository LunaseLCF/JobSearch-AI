import http from 'http';

let last = null;
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/last') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(last));
  }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(body); } catch (e) { /* ignore */ }
    last = payload;
    const text = [payload.system, ...(payload.messages || []).map(m => m.content)].join('\n');
    const directive = text.match(/Write ALL user-facing text in (Simplified Chinese|Thai|English)\./);
    const lang = directive?.[1] === 'Simplified Chinese' ? 'zh' : directive?.[1] === 'Thai' ? 'th' : 'en';
    const words = {
      zh: ['中文STAR标题', '中文情境', '中文任务', '中文行动', '中文结果', '中文面试问题', '中文谈话要点', '中文提问', '中文匹配项', '中文待补项', '中文定制摘要', '中文亮点', '中文修改'],
      th: ['หัวข้อSTARภาษาไทย', 'สถานการณ์ภาษาไทย', 'งานภาษาไทย', 'การดำเนินการภาษาไทย', 'ผลลัพธ์ภาษาไทย', 'คำถามสัมภาษณ์ภาษาไทย', 'จุดพูดภาษาไทย', 'คำถามที่ถามภาษาไทย', 'ตรงกันภาษาไทย', 'ขาดภาษาไทย', 'สรุปภาษาไทย', 'ไฮไลต์ภาษาไทย', 'การเปลี่ยนแปลงภาษาไทย'],
      en: ['English STAR title', 'English situation', 'English task', 'English action', 'English result', 'English interview question', 'English talking point', 'English question to ask', 'English matched', 'English missing', 'English tailored summary', 'English highlight', 'English change'],
    }[lang];
    const [starTitle, situation, task, action, result, question, talkingPoint, ask, matched, missing, summary, highlight, change] = words;
    const content = JSON.stringify({
      starExamples: [{ title: starTitle, situation, task, action, result }],
      likelyQuestions: [question],
      talkingPoints: [talkingPoint],
      questionsToAsk: [ask],
      matched: [matched],
      missing: [missing],
      coverage: 80,
      summary,
      highlights: [highlight],
      changes: [change],
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});
server.listen(4103, () => console.log('language mock on 4103'));
