/**
 * Túnel SSH automático para desenvolvimento local.
 * Quando TUNNEL_SSH_HOST está no .env, abre um forward TCP
 * para o MySQL remoto antes de criar os pools de banco.
 *
 * Em produção (sem TUNNEL_SSH_HOST) este módulo não faz nada.
 *
 * Resiliência: se a sessão SSH cair, reconecta sozinho (com keepalive p/ não
 * morrer por ociosidade). O handler de conexão local nunca chama forwardOut numa
 * sessão morta — antes isso lançava "Not connected" de forma síncrona e virava
 * uncaughtException, re-disparando o alerta a cada 5 min.
 */
const net = require('net');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

let _server = null;
let _client = null;
let _localPort = null;
let _ready = false;          // SSH conectado e utilizável
let _closing = false;        // closeTunnel() chamado — não reconectar
let _reconnectTimer = null;

function getTunnelConfig() {
  const host = (process.env.TUNNEL_SSH_HOST || '').trim();
  if (!host) return null;

  const keyPath = (process.env.TUNNEL_SSH_KEY || '').trim()
    || path.join(process.env.USERPROFILE || process.env.HOME || '', '.ssh', 'hostinger_key');

  return {
    sshHost:    host,
    sshPort:    parseInt(process.env.TUNNEL_SSH_PORT  || '22', 10),
    sshUser:    (process.env.TUNNEL_SSH_USER || 'root').trim(),
    privateKey: fs.existsSync(keyPath) ? fs.readFileSync(keyPath) : null,
    remoteHost: (process.env.TUNNEL_REMOTE_HOST || 'localhost').trim(),
    remotePort: 3306,
    localPort:  parseInt(process.env.TUNNEL_LOCAL_PORT || process.env.DB_PORT || '3308', 10),
  };
}

// Servidor TCP local: cada conexão vira um forward pela sessão SSH atual.
// Criado uma única vez; nas reconexões reaproveita e usa o _client novo.
function _criarServidorLocal(cfg, resolve, reject) {
  const server = net.createServer((sock) => {
    // Túnel caído: recusa a conexão em vez de estourar no forwardOut.
    if (!_ready || !_client) { sock.destroy(); return; }
    try {
      _client.forwardOut('127.0.0.1', 0, cfg.remoteHost, cfg.remotePort, (err, stream) => {
        if (err) { sock.destroy(); return; }
        sock.pipe(stream);
        stream.pipe(sock);
        stream.on('close', () => sock.destroy());
        sock.on('close',   () => { try { stream.destroy(); } catch (_) {} });
        sock.on('error',   () => { try { stream.destroy(); } catch (_) {} });
        stream.on('error', () => sock.destroy());
      });
    } catch (e) {
      // ssh2 lança "Not connected" de forma síncrona quando a sessão caiu.
      sock.destroy();
    }
  });

  server.listen(cfg.localPort, '127.0.0.1', () => {
    _server = server;
    _localPort = cfg.localPort;
    console.log(`[tunnel] SSH pronto → ${cfg.sshUser}@${cfg.sshHost}:${cfg.sshPort} | local: 127.0.0.1:${cfg.localPort} → ${cfg.remoteHost}:${cfg.remotePort}`);
    resolve(cfg.localPort);
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      _localPort = cfg.localPort;
      console.log(`[tunnel] Porta ${cfg.localPort} já em uso — assumindo túnel ativo`);
      resolve(cfg.localPort);
    } else {
      reject(e);
    }
  });
}

function _agendarReconexao(cfg) {
  if (_closing || _reconnectTimer) return;
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    _conectarSSH(cfg).catch((e) => {
      console.error('[tunnel] reconexão falhou:', e.message);
      _agendarReconexao(cfg);
    });
  }, 3000);
}

function _conectarSSH(cfg) {
  return new Promise((resolve, reject) => {
    const ssh = new Client();
    _client = ssh;
    _ready = false;
    let _settled = false;
    const done = (fn, arg) => { if (!_settled) { _settled = true; fn(arg); } };

    ssh.on('error', (e) => {
      console.error('[tunnel] SSH error:', e.message);
      _ready = false;
      done(reject, e);
    });

    ssh.on('close', () => {
      _ready = false;
      if (!_closing) {
        console.warn('[tunnel] conexão SSH caiu — reconectando em 3s...');
        _agendarReconexao(cfg);
      }
    });

    ssh.on('ready', () => {
      _ready = true;
      // O servidor local é criado só na 1ª conexão; nas reconexões o handler
      // já existente passa a usar o _client novo automaticamente.
      if (_server && _server.listening) { done(resolve, _localPort); return; }
      _criarServidorLocal(cfg, (p) => done(resolve, p), (e) => done(reject, e));
    });

    const connectOpts = {
      host:     cfg.sshHost,
      port:     cfg.sshPort,
      username: cfg.sshUser,
      keepaliveInterval: 30000,  // evita queda por ociosidade
      keepaliveCountMax: 3,
    };
    if (cfg.privateKey) {
      connectOpts.privateKey = cfg.privateKey;
    } else if (process.env.TUNNEL_SSH_PASSWORD) {
      connectOpts.password = process.env.TUNNEL_SSH_PASSWORD;
    }

    ssh.connect(connectOpts);
  });
}

function openTunnel() {
  const cfg = getTunnelConfig();
  if (!cfg) return Promise.resolve(null);
  if (_server && _server.listening) return Promise.resolve(_localPort);
  _closing = false;
  return _conectarSSH(cfg);
}

function closeTunnel() {
  _closing = true;
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  if (_server) { try { _server.close(); } catch (_) {} _server = null; }
  if (_client) { try { _client.end();   } catch (_) {} _client = null; }
  _ready = false;
  _localPort = null;
}

module.exports = { openTunnel, closeTunnel, getTunnelConfig };
