const fs = require('fs');
const net = require('net');
const tls = require('tls');
const path = require('path');
const { once } = require('events');

const ROOT = path.join(__dirname, '..');
const OUTBOX = path.join(ROOT, 'data', 'outbox');

// Minimal .env loader so SMTP settings can live beside the app without a dependency.
function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function mailConfig() {
  loadEnvFile();
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host: process.env.SMTP_HOST || '',
    port,
    secure: process.env.SMTP_SECURE ? /^(1|true|yes)$/i.test(process.env.SMTP_SECURE) : port === 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    baseUrl: process.env.APP_BASE_URL || '',
  };
}

class SmtpSession {
  constructor(socket) {
    this.attach(socket);
  }

  attach(socket) {
    this.socket = socket;
    this.buffer = '';
    this.lines = [];
    this.responses = [];
    this.waiters = [];
    this.onData = chunk => {
      this.buffer += chunk.toString('utf8');
      let index;
      while ((index = this.buffer.indexOf('\r\n')) >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        this.lines.push(line);
        const complete = /^\d{3} /.test(line);
        if (complete) {
          const response = { code: Number(line.slice(0, 3)), text: this.lines.join('\n') };
          this.lines = [];
          if (this.waiters.length) this.waiters.shift()(response);
          else this.responses.push(response);
        }
      }
    };
    socket.on('data', this.onData);
  }

  detach() {
    if (this.socket && this.onData) this.socket.off('data', this.onData);
    this.lines = [];
  }

  read() {
    if (this.responses.length) return Promise.resolve(this.responses.shift());
    return new Promise(resolve => this.waiters.push(resolve));
  }

  async command(line, allowed) {
    this.socket.write(line + '\r\n');
    const response = await this.read();
    if (allowed && !allowed.includes(response.code)) {
      throw new Error(`SMTP ${response.code}: ${response.text.slice(0, 300)}`);
    }
    return response;
  }
}

function mimeEncode(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMessage({ from, to, subject, text, html }) {
  const boundary = '----AIJobSearch' + Date.now().toString(16);
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${mimeEncode(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
  ].join('\r\n');
  const part = (type, body) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body, 'utf8').toString('base64'),
  ].join('\r\n');
  return headers + '\r\n' + part('text/plain', text) + '\r\n' + part('text/html', html) + `\r\n--${boundary}--\r\n`;
}

async function sendSmtp(config, message) {
  const socket = config.secure
    ? tls.connect({ host: config.host, port: config.port, servername: config.host })
    : net.connect({ host: config.host, port: config.port });
  const timeout = setTimeout(() => socket.destroy(new Error('SMTP connection timed out')), 20000);
  let session = new SmtpSession(socket);

  try {
    if (config.secure) await once(socket, 'secureConnect');
    else await once(socket, 'connect');

    await session.read(); // greeting
    let ehlo = await session.command(`EHLO localhost`, [250]);

    if (!config.secure && /STARTTLS/i.test(ehlo.text)) {
      await session.command('STARTTLS', [220]);
      session.detach();
      const secureSocket = tls.connect({ socket, servername: config.host, rejectUnauthorized: false });
      await once(secureSocket, 'secureConnect');
      socket = secureSocket;
      session = new SmtpSession(secureSocket);
      ehlo = await session.command('EHLO localhost', [250]);
    }

    if (config.user) {
      if (/AUTH[ =\t][^\n]*PLAIN/i.test(ehlo.text)) {
        const credentials = Buffer.from(`\0${config.user}\0${config.pass}`, 'utf8').toString('base64');
        await session.command(`AUTH PLAIN ${credentials}`, [235]);
      } else if (/AUTH[ =\t][^\n]*LOGIN/i.test(ehlo.text)) {
        await session.command('AUTH LOGIN', [334]);
        await session.command(Buffer.from(config.user).toString('base64'), [334]);
        await session.command(Buffer.from(config.pass).toString('base64'), [235]);
      } else {
        throw new Error('SMTP server does not advertise PLAIN or LOGIN authentication');
      }
    }

    const fromAddress = message.from.replace(/<.*>/, '').replace(/[<>]/g, '').trim();
    await session.command(`MAIL FROM:<${fromAddress}>`, [250]);
    await session.command(`RCPT TO:<${message.to}>`, [250, 251]);
    await session.command('DATA', [354]);
    const body = message.raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    socket.write(body.endsWith('\r\n') ? body + '.\r\n' : body + '\r\n.\r\n');
    await session.read();
    await session.command('QUIT', [221]);
    return { delivered: true, transport: 'smtp' };
  } finally {
    clearTimeout(timeout);
    socket.destroy();
  }
}

function writeOutbox(message) {
  fs.mkdirSync(OUTBOX, { recursive: true });
  const filename = `${Date.now()}-${message.to.replace(/[^a-zA-Z0-9@._-]/g, '_')}.eml`;
  fs.writeFileSync(path.join(OUTBOX, filename), message.raw, 'utf8');
  return { delivered: true, transport: 'outbox', file: path.relative(ROOT, path.join(OUTBOX, filename)).replace(/\\/g, '/') };
}

async function sendResetEmail({ to, name, resetUrl }) {
  const config = mailConfig();
  const from = config.from || 'no-reply@localhost';
  const subject = 'Reset your AI Job Search password';
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const text = [
    greeting,
    '',
    'We received a request to reset your AI Job Search password.',
    `Open this link to choose a new password: ${resetUrl}`,
    'This link expires in 30 minutes. If you did not request it, you can ignore this email.',
    '',
    'AI Job Search',
  ].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
      <h2>Reset your password</h2>
      <p>${greeting}</p>
      <p>We received a request to reset your AI Job Search password.</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:12px 20px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none">Choose a new password</a></p>
      <p style="font-size:12px;color:#6b7280">This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>
    </div>`;
  const message = { from: `AI Job Search <${from}>`, to, subject, text, html, raw: buildMessage({ from: `AI Job Search <${from}>`, to, subject, text, html }) };

  if (config.host) {
    try {
      return await sendSmtp(config, message);
    } catch (error) {
      return { delivered: false, transport: 'smtp', error: error.message, fallback: writeOutbox(message) };
    }
  }
  return writeOutbox(message);
}

module.exports = { sendResetEmail, mailConfig, loadEnvFile };
