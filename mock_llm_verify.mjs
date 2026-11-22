import http from 'http';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
  });
});
server.listen(4102, () => console.log('mock llm on 4102'));
