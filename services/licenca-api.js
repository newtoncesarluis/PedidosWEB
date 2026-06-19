const BASE_URL = (process.env.LICENCA_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const API_KEY  = process.env.LICENCA_API_KEY || '';
const SISTEMA  = process.env.LICENCA_SISTEMA || 'pedidosweb';

async function _post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  return res.json();
}

async function _put(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return res.json();
}

// Verifica se a licença está válida e se há vagas.
// Retorna { valida, motivo, licenca, aviso, sessao_derrubada }
async function verificarLicenca(chave_licenca) {
  return _post('/api/licenca/verificar', { chave_licenca });
}

// Registra a sessão do usuário após login bem-sucedido.
// Retorna { id } — o sessao_id deve ser guardado no JWT ou em memória para o heartbeat/logout.
async function registrarSessao({ chave_licenca, usuario_id, usuario_nome, usuario_email, usuario_perfil, ip, user_agent, token_hash }) {
  return _post('/api/sessoes/registrar', {
    chave_licenca, sistema: SISTEMA,
    usuario_id, usuario_nome, usuario_email, usuario_perfil,
    ip, user_agent, token_hash,
  });
}

// Atualiza o timestamp da sessão (manter viva).
// Retorna { kicked: bool } — se kicked=true o frontend deve deslogar o usuário.
async function heartbeat(token_hash, chave_licenca) {
  try {
    return await _put('/api/sessoes/heartbeat', { token_hash, chave_licenca });
  } catch {
    return { kicked: false };
  }
}

// Encerra a sessão no logout.
async function encerrarSessao(token_hash) {
  try {
    return await _post('/api/sessoes/logout', { token_hash });
  } catch {}
}

module.exports = { verificarLicenca, registrarSessao, heartbeat, encerrarSessao };
