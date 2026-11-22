import http from 'http';
import fs from 'fs';

const LOG = 'data/tmp/_cn_mock_prompt.txt';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body);
      fs.writeFileSync(LOG, JSON.stringify(payload, null, 2));
      const content = JSON.stringify({
        identity: { name: '李四', email: 'lisi@example.com', phone: '13900139000', location: '上海', cvLanguage: 'English' },
        languages: [{ language: '中文', level: '母语' }],
        education: [{ degree: '硕士', institution: '复旦大学', start: '2016', end: '2019', topics: '软件工程' }],
        experience: [{ title: '高级工程师', company: '上海科技公司', start: '2019', end: '至今', location: '上海', bullets: ['负责平台架构设计'] }],
        skills: { primary: ['Java'], secondary: ['Spring'], domain: [], software: ['Docker'] },
        behavioral: { traits: [], strengths: [] },
        careerGoals: { targetRoles: [], targetSectors: [] },
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});
server.listen(4105, () => console.log('cn mock llm on 4105'));
