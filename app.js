import { SUPABASE_URL, SUPABASE_CHAVE } from './config.js';
import { detectarAparelho } from './aparelho.js';
import { SENSORES, detectarTodos, pedirPermissaoMovimento, precisaToqueParaMovimento } from './sensores.js';
import { criarDashboard } from './dashboard.js';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_CHAVE, {
  auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
});

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const ler = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };

let usuario = null;
let aparelho = null;      // dados detectados do aparelho
let aparelhoId = null;    // id na tabela "aparelhos"
let deteccao = null;      // { sensorId: { estado, motivo } }
let dashboard = null;

// ---------------- Login ----------------
$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  $('botao-login').disabled = true;
  $('login-erro').hidden = true;
  const { error } = await sb.auth.signInWithOtp({
    email, options: { emailRedirectTo: location.origin + location.pathname },
  });
  $('botao-login').disabled = false;
  if (error) {
    const limite = /rate limit|too many|security purposes/i.test(error.message);
    $('login-erro').textContent = limite
      ? 'Muitos pedidos de link em pouco tempo. Use o último link que chegou no e-mail ou espere alguns minutos.'
      : 'Não foi possível enviar o link: ' + error.message;
    $('login-erro').hidden = false;
    return;
  }
  $('email-enviado').textContent = email;
  $('form-login').hidden = true;
  $('login-enviado').hidden = false;
});
$('outro-email').addEventListener('click', () => { $('form-login').hidden = false; $('login-enviado').hidden = true; });
$('sair').addEventListener('click', async () => { await pararColeta(); await sb.auth.signOut(); });

sb.auth.onAuthStateChange((_evento, sessao) => {
  const novo = sessao?.user || null;
  if (novo?.id === usuario?.id) return;
  usuario = novo;
  // limpa o token do endereço depois do login pelo link
  if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname);
  setTimeout(mostrarTela, 0);
});

function mostrarTela() {
  $('tela-login').hidden = !!usuario;
  $('tela-app').hidden = !usuario;
  $('conta').hidden = !usuario;
  if (!usuario) return;
  $('conta-email').textContent = usuario.email;
  iniciarApp();
}

// ---------------- Aparelho e sensores ----------------
async function iniciarApp() {
  aparelhoId = ler('aparelho_id:' + usuario.id);
  aparelho = await detectarAparelho();
  desenharAparelho();
  if (!precisaToqueParaMovimento()) detectar(); // iPhone e Chrome recentes só liberam movimento após um toque
}

function desenharAparelho() {
  const a = aparelho;
  const campos = [
    ['Marca', a.marca || 'Não identificada'],
    ['Modelo', a.modelo + (a.modelo_estimado ? ' (estimado)' : '')],
    ['Sistema', a.sistema],
    ['Navegador', a.navegador],
  ];
  $('aparelho-info').innerHTML = campos.map(([r, v]) =>
    `<div class="dado"><div class="rotulo">${r}</div><div class="valor">${esc(v)}</div></div>`).join('')
    + (a.nota ? `<p class="dado nota" style="grid-column:1/-1;margin:0">${esc(a.nota)}</p>` : '');
}

$('detectar').addEventListener('click', () => {
  const permissao = pedirPermissaoMovimento(); // precisa ser o primeiro passo do toque
  detectar(permissao);
});

async function detectar(permissao) {
  $('detectar').disabled = true;
  $('detectar').textContent = 'Detectando…';
  $('lista-sensores').innerHTML = '<p class="sub">Testando cada sensor (2 segundos)…</p>';
  if (permissao && (await permissao) === 'denied') {
    $('sensores-dica').innerHTML = '⚠️ Acesso ao movimento negado. Feche e reabra a página e toque em <b>Permitir</b> quando o navegador perguntar.';
  }
  deteccao = await detectarTodos();
  $('detectar').disabled = false;
  $('detectar').textContent = 'Detectar de novo';
  const qtd = Object.values(deteccao).filter((d) => d.estado !== 'indisponivel').length;
  $('sensores-dica').textContent = `${qtd} de ${SENSORES.length} sensores podem ser lidos neste aparelho. Marque os que deseja coletar.`;
  desenharSensores();
  $('nao-acessiveis').hidden = false;
  $('cartao-coleta').hidden = false;
  await registrarAparelho();
}

function desenharSensores() {
  const escolhidos = ler('sensores_escolhidos') || ['acelerometro', 'giroscopio', 'orientacao', 'bateria'];
  const ordem = { disponivel: 0, permissao: 1, indisponivel: 2 };
  const selos = { disponivel: 'Disponível', permissao: 'Pede permissão', indisponivel: 'Indisponível' };
  const lista = [...SENSORES].sort((a, b) => ordem[deteccao[a.id].estado] - ordem[deteccao[b.id].estado]);
  $('lista-sensores').innerHTML = lista.map((s) => {
    const d = deteccao[s.id];
    const off = d.estado === 'indisponivel';
    return `<label class="sensor ${off ? 'indisponivel' : ''}">
      <input type="checkbox" value="${s.id}" ${off ? 'disabled' : ''} ${!off && escolhidos.includes(s.id) ? 'checked' : ''}>
      <div><div class="nome">${s.icone} ${esc(s.nome)}</div>
        <div class="desc">${esc(off && d.motivo ? d.motivo : d.motivo && d.estado === 'permissao' ? s.desc + ' ' + d.motivo : s.desc)}</div></div>
      <span class="selo ${d.estado}">${selos[d.estado]}</span>
    </label>`;
  }).join('');
  $('lista-sensores').querySelectorAll('input').forEach((i) => i.addEventListener('change', () => {
    guardar('sensores_escolhidos', marcados().map((s) => s.id));
  }));
}
const marcados = () => [...$('lista-sensores').querySelectorAll('input:checked')]
  .map((i) => SENSORES.find((s) => s.id === i.value));

async function registrarAparelho() {
  const linha = {
    marca: aparelho.marca, modelo: aparelho.modelo, modelo_estimado: aparelho.modelo_estimado,
    sistema: aparelho.sistema, navegador: aparelho.navegador, user_agent: aparelho.user_agent,
    sensores: deteccao, visto_em: new Date().toISOString(),
  };
  if (aparelhoId) {
    const { data } = await sb.from('aparelhos').update(linha).eq('id', aparelhoId).select('id');
    if (data?.length) return;
  }
  const { data, error } = await sb.from('aparelhos').insert(linha).select('id').single();
  if (error) { $('sensores-dica').textContent = 'Erro ao registrar o aparelho: ' + error.message; return; }
  aparelhoId = data.id;
  guardar('aparelho_id:' + usuario.id, aparelhoId);
}

// ---------------- Coleta ----------------
let coletando = false;
let ativos = [];
let relogio = null;
let fila = [];
let enviando = false;
let enviadas = 0;
let travaTela = null;
const MAX_FILA = 20000;

$('botao-coleta').addEventListener('click', () => (coletando ? pararColeta() : iniciarColeta()));

async function iniciarColeta() {
  const escolhidos = marcados();
  if (!escolhidos.length) { $('coleta-status').textContent = 'Marque pelo menos um sensor.'; return; }
  // Passos que o iPhone exige dentro do toque, antes de qualquer espera:
  const permissao = pedirPermissaoMovimento();
  escolhidos.forEach((s) => s.preparar?.());

  $('botao-coleta').disabled = true;
  $('coleta-status').textContent = 'Ligando sensores… (aceite os pedidos de permissão)';
  await permissao;
  if (!aparelhoId) await registrarAparelho();
  if (!aparelhoId) { $('botao-coleta').disabled = false; return; }

  ativos = []; const falhas = [];
  for (const s of escolhidos) {
    try { await s.iniciar(); ativos.push(s); } catch (e) { s.parar?.(); falhas.push(`${s.nome}: ${e.message || 'permissão negada'}`); }
  }
  $('botao-coleta').disabled = false;
  if (!ativos.length) { $('coleta-status').textContent = 'Nenhum sensor ligou. ' + falhas.join(' · '); return; }

  coletando = true; enviadas = 0;
  $('botao-coleta').textContent = '■ Parar coleta';
  $('botao-coleta').classList.add('parar');
  $('lista-sensores').querySelectorAll('input').forEach((i) => (i.disabled = true));
  $('intervalo').disabled = true;
  $('detectar').disabled = true;
  $('ao-vivo').innerHTML = ativos.map((s) =>
    `<div class="cartao"><div class="rotulo">${s.icone} ${esc(s.nome)}</div><div class="valor" id="vivo-${s.id}">aguardando…</div></div>`).join('');
  $('coleta-status').dataset.falhas = falhas.join(' · ');
  await manterTelaLigada();
  relogio = setInterval(ciclo, +$('intervalo').value * 1000);
  atualizarStatus();
}

async function pararColeta() {
  if (!coletando) return;
  coletando = false;
  clearInterval(relogio);
  ativos.forEach((s) => s.parar());
  ativos = [];
  travaTela?.release().catch(() => {});
  travaTela = null;
  $('botao-coleta').textContent = '▶ Iniciar coleta';
  $('botao-coleta').classList.remove('parar');
  $('intervalo').disabled = false;
  $('detectar').disabled = false;
  desenharSensores();
  await enviar();
  atualizarStatus();
}

async function ciclo() {
  const agora = new Date().toISOString();
  for (const s of ativos) {
    const d = s.amostra();
    if (!d) continue;
    fila.push({ aparelho_id: aparelhoId, sensor: s.id, dados: d, medido_em: agora });
    const el = $('vivo-' + s.id);
    if (el) el.textContent = s.texto(d);
  }
  if (fila.length > MAX_FILA) fila.splice(0, fila.length - MAX_FILA);
  await enviar();
  atualizarStatus();
}

async function enviar() {
  if (enviando || !fila.length) return;
  enviando = true;
  const lote = fila.splice(0, 500);
  const { error } = await sb.from('leituras').insert(lote);
  if (error) { fila.unshift(...lote); $('coleta-status').dataset.erro = error.message; }
  else { enviadas += lote.length; delete $('coleta-status').dataset.erro; }
  enviando = false;
}

function atualizarStatus() {
  const parou = !coletando;
  const st = $('coleta-status');
  const partes = [parou ? '⏹ Coleta parada.' : `🟢 Coletando a cada ${$('intervalo').selectedOptions[0].text}.`,
    `${enviadas.toLocaleString('pt-BR')} leituras salvas`];
  if (fila.length) partes.push(`${fila.length} aguardando internet`);
  if (st.dataset.erro) partes.push('⚠️ ' + st.dataset.erro);
  if (st.dataset.falhas) partes.push('Não ligaram: ' + st.dataset.falhas);
  if (!parou) partes.push('Mantenha o app aberto e a tela ligada.');
  st.textContent = partes.join(' · ');
}

async function manterTelaLigada() {
  try { travaTela = await navigator.wakeLock?.request('screen'); } catch { travaTela = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && coletando) manterTelaLigada();
});

// ---------------- Abas ----------------
document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.aba').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  const dash = b.dataset.aba === 'dashboard';
  $('aba-coletar').hidden = dash;
  $('aba-dashboard').hidden = !dash;
  dashboard ||= criarDashboard(sb, () => aparelhoId);
  if (dash) dashboard.abrir(); else dashboard.fechar();
}));

// Primeira tela (caso não haja sessão salva nem link de login no endereço)
sb.auth.getSession().then(({ data }) => { if (!data.session && !usuario) mostrarTela(); });
