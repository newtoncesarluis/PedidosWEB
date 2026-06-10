/**
 * Túnel SSH automático para desenvolvimento local.
 * Quando TUNNEL_SSH_HOST está no .env, abre um forward TCP
 * para o MySQL remoto antes de criar os pools de banco.
 *
 * Em produção (sem TUNNEL_SSH_HOST) este módulo não faz nada.
 */
const net = require('net');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

let _server = null;
let _client = null;
let _localPort = null;

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
    localPort:  parseInt(process.env.DB_PORT || '3308', 10),
  };
}

function openTunnel() {
  const cfg = getTunnelConfig();
  if (!cfg) return Promise.resolve(null);
  if (_server && _server.listening) return Promise.resolve(_localPort);

  return new Promise((resolve, reject) => {
    const ssh = new Client();
    _client = ssh;

    ssh.on('error', (e) => {
      console.error('[tunnel] SSH error:', e.message);
      reject(e);
    });

    ssh.on('ready', () => {
      // SSH pronto — agora cria o servidor local
      const server = net.createServer((sock) => {
        ssh.forwardOut(
          '127.0.0.1', 0,
          cfg.remoteHost, cfg.remotePort,
          (err, stream) => {
            if (err) { sock.destroy(); return; }
            sock.pipe(stream);
            stream.pipe(sock);
            stream.on('close', () => sock.destroy());
            sock.on('close',   () => { try { stream.destroy(); } catch(_){} });
            sock.on('error',   () => { try { stream.destroy(); } catch(_){} });
            stream.on('error', () => sock.destroy());
          }
        );
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
    });

    const connectOpts = {
      host:     cfg.sshHost,
      port:     cfg.sshPort,
      username: cfg.sshUser,
    };
    if (cfg.privateKey) {
      connectOpts.privateKey = cfg.privateKey;
    } else if (process.env.TUNNEL_SSH_PASSWORD) {
      connectOpts.password = process.env.TUNNEL_SSH_PASSWORD;
    }

    ssh.connect(connectOpts);
  });
}

function closeTunnel() {
  if (_server) { try { _server.close(); } catch (_) {} _server = null; }
  if (_client) { try { _client.end();   } catch (_) {} _client = null; }
  _localPort = null;
}

module.exports = { openTunnel, closeTunnel, getTunnelConfig };
