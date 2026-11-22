import http from 'http';
http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '' } }] }));
  });
}).listen(4104, () => console.log('empty-response mock on 4104'));
