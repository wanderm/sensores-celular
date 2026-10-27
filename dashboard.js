// Dashboard: lê as leituras do Supabase e desenha resumo, gráficos, mapa e tabelas.
import { SENSORES } from './sensores.js';

const GRAFICOS = {
  acelerometro: { series: [['x', 'x'], ['y', 'y'], ['z', 'z']] },
  giroscopio: { series: [['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ']] },
  orientacao: { series: [['beta', 'β (frente/trás)'], ['gamma', 'γ (lados)']], titulo: 'Inclinação' },
  bateria: { series: [['nivel', 'Nível']], min: 0, max: 100 },
  som: { series: [['nivel_medio', 'Médio'], ['nivel_max', 'Pico']], min: 0, max: 100 },
  rede: { series: [['downlink', 'Velocidade estimada']] },
  luz: { series: [['illuminance', 'Luz']] },
  magnetometro: { series: [['x', 'x'], ['y', 'y'], ['z', 'z']] },
  localizacao: { mapa: true },
};
const LIMITE = 2000; // leituras por sensor no período

const $ = (id) => document.getElementById(id);
const cor = (nome) => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
const fmtNum = (v, casas = 2) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas }));
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtHora(ms, minutos) {
  const d = new Date(ms);
  if (minutos <= 60) return d.toLocaleTimeString('pt-BR');
  if (minutos <= 1440) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function haQuanto(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} dias`;
}

export function criarDashboard(sb, aparelhoAtualId) {
  const graficos = {}; // sensor -> { el, chart | mapa, camadas }
  let dados = {};      // sensor -> [{t, d}]
  let relogio = null;
  let carregando = false;

  async function carregarAparelhos() {
    const { data, error } = await sb.from('aparelhos').select('id, marca, modelo, sistema, visto_em').order('visto_em', { ascending: false });
    if (error) { $('dash-status').textContent = 'Erro ao carregar aparelhos: ' + error.message; return; }
    const sel = $('dash-aparelho');
    const anterior = sel.value;
    sel.innerHTML = data.map((a) => {
      const nome = [a.marca, a.modelo].filter(Boolean).join(' ') || 'Aparelho';
      const atual = a.id === aparelhoAtualId() ? ' (este)' : '';
      return `<option value="${a.id}">${esc(nome)}${atual} · ${esc(a.sistema || '')}</option>`;
    }).join('');
    const preferido = [anterior, aparelhoAtualId()].find((id) => id && data.some((a) => a.id === id));
    if (preferido) sel.value = preferido;
  }

  async function atualizar() {
    const aparelho = $('dash-aparelho').value;
    if (!aparelho) {
      $('dash-graficos').innerHTML = '<div class="cartao vazio">Nenhum aparelho ainda. Abra o app no celular, detecte os sensores e inicie a coleta.</div>';
      $('dash-resumo').innerHTML = ''; $('dash-acoes').hidden = true;
      return;
    }
    if (carregando) return;
    carregando = true;
    $('dash-graficos').classList.add('carregando');
    const minutos = +$('dash-periodo').value;
    const desde = new Date(Date.now() - minutos * 60000).toISOString();

    const consultas = SENSORES.map((s) => sb.from('leituras')
      .select('dados, medido_em')
      .eq('aparelho_id', aparelho).eq('sensor', s.id).gte('medido_em', desde)
      .order('medido_em', { ascending: false }).limit(LIMITE)
      .then(({ data, error }) => [s.id, error ? [] : data.reverse().map((r) => ({ t: Date.parse(r.medido_em), d: r.dados }))]));
    const total = sb.from('leituras').select('id', { count: 'exact', head: true })
      .eq('aparelho_id', aparelho).gte('medido_em', desde);

    const [resultados, { count, error }] = await Promise.all([Promise.all(consultas), total]);
    dados = Object.fromEntries(resultados);
    carregando = false;
    $('dash-graficos').classList.remove('carregando');
    if (error) { $('dash-status').textContent = 'Erro ao ler dados: ' + error.message; return; }

    $('dash-status').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')}`;
    desenharResumo(count || 0);
    desenharGraficos(minutos);
    $('dash-acoes').hidden = !(count > 0);
  }

  function desenharResumo(total) {
    const comDados = SENSORES.filter((s) => dados[s.id]?.length);
    const ultima = Math.max(0, ...comDados.map((s) => dados[s.id].at(-1).t));
    const bat = dados.bateria?.at(-1)?.d;
    const tiles = [
      ['Leituras no período', total.toLocaleString('pt-BR'), ''],
      ['Última leitura', ultima ? haQuanto(ultima) : '—', ultima ? new Date(ultima).toLocaleString('pt-BR') : 'nenhuma ainda'],
      ['Sensores com dados', String(comDados.length), comDados.map((s) => s.nome.split(' ')[0]).join(', ')],
    ];
    if (bat) tiles.push(['Bateria agora', `${bat.nivel}%`, bat.carregando ? '⚡ carregando' : 'na bateria']);
    $('dash-resumo').innerHTML = tiles.map(([r, n, nota]) =>
      `<div class="cartao tile"><div class="rotulo">${r}</div><div class="numero">${esc(n)}</div><div class="nota">${esc(nota)}</div></div>`).join('');
  }

  function desenharGraficos(minutos) {
    const area = $('dash-graficos');
    const sensoresComDados = SENSORES.filter((s) => dados[s.id]?.length);
    if (!sensoresComDados.length) {
      area.innerHTML = '<div class="cartao vazio">Sem leituras neste período. Inicie a coleta na aba <b>Meu aparelho</b> ou escolha um período maior.</div>';
      for (const k of Object.keys(graficos)) delete graficos[k];
      return;
    }
    // remove cartões de sensores que ficaram sem dados
    area.querySelector('.vazio')?.remove();
    for (const id of Object.keys(graficos)) {
      if (!dados[id]?.length) { graficos[id].chart?.destroy(); graficos[id].mapa?.remove(); graficos[id].el.remove(); delete graficos[id]; }
    }
    for (const s of sensoresComDados) {
      const cfg = GRAFICOS[s.id];
      if (!graficos[s.id]) graficos[s.id] = criarCartao(s, cfg, area);
      if (cfg.mapa) atualizarMapa(graficos[s.id], dados[s.id]);
      else atualizarLinha(graficos[s.id], cfg, dados[s.id], minutos);
      preencherTabela(graficos[s.id], s, dados[s.id], minutos);
    }
  }

  function criarCartao(s, cfg, area) {
    const el = document.createElement('section');
    el.className = 'cartao grafico';
    const legenda = !cfg.mapa && cfg.series.length > 1
      ? `<div class="legenda">${cfg.series.map(([, nome], i) => `<span><i style="background:var(--serie-${i + 1})"></i>${esc(nome)}</span>`).join('')}</div>` : '';
    el.innerHTML = `
      <h3>${s.icone} ${esc(cfg.titulo || s.nome)}</h3>
      <div class="unidade">${cfg.mapa ? 'Trajeto no período (último ponto marcado)' : 'Unidade: ' + esc(s.unidade)}</div>
      ${legenda}
      ${cfg.mapa ? '<div class="mapa"></div>' : '<div class="area"><canvas></canvas></div>'}
      <details><summary>Ver tabela</summary><div class="tabela-rolagem"></div></details>`;
    area.appendChild(el);
    const g = { el };
    if (cfg.mapa) {
      g.mapa = L.map(el.querySelector('.mapa'), { attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap',
      }).addTo(g.mapa);
    } else {
      g.chart = new Chart(el.querySelector('canvas'), configLinha(cfg));
    }
    return g;
  }

  function configLinha(cfg) {
    const grade = cor('--grade'); const fraco = cor('--texto-fraco');
    return {
      type: 'line',
      data: {
        datasets: cfg.series.map(([campo, nome], i) => ({
          label: nome, campo, data: [], parsing: false,
          borderColor: cor(`--serie-${i + 1}`), backgroundColor: cor(`--serie-${i + 1}`),
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2, spanGaps: true,
        })),
      },
      options: {
        animation: false, maintainAspectRatio: false, normalized: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (itens) => new Date(itens[0].parsed.x).toLocaleString('pt-BR'),
              label: (c) => ` ${c.dataset.label}: ${fmtNum(c.parsed.y)}`,
            },
          },
        },
        scales: {
          x: { type: 'linear', grid: { color: grade }, border: { color: cor('--eixo') }, ticks: { color: fraco, maxTicksLimit: 6, maxRotation: 0 } },
          y: { min: cfg.min, max: cfg.max, grid: { color: grade }, border: { display: false }, ticks: { color: fraco, maxTicksLimit: 6 } },
        },
      },
    };
  }

  function atualizarLinha(g, cfg, linhas, minutos) {
    const ch = g.chart;
    const poucos = linhas.length <= 60; // com poucas leituras, mostra os pontos
    ch.data.datasets.forEach((ds) => {
      ds.data = linhas.map((r) => ({ x: r.t, y: r.d[ds.campo] ?? null }));
      ds.pointRadius = poucos ? 3 : 0;
    });
    // eixo ajustado aos dados (não ao período inteiro), para não espremer coletas curtas
    const inicio = linhas[0].t; const fim = linhas.at(-1).t;
    const folga = Math.max((fim - inicio) * 0.02, 5000);
    ch.options.scales.x.min = inicio - folga;
    ch.options.scales.x.max = fim + folga;
    ch.options.scales.x.ticks.callback = (v) => fmtHora(v, minutos);
    ch.update('none');
  }

  function atualizarMapa(g, linhas) {
    const pontos = linhas.filter((r) => r.d.lat != null).map((r) => [r.d.lat, r.d.lon]);
    if (!pontos.length) return;
    g.camadas?.forEach((c) => c.remove());
    const ultimo = linhas.at(-1).d;
    const linha = L.polyline(pontos, { color: cor('--serie-1'), weight: 3 }).addTo(g.mapa);
    const precisao = L.circle(pontos.at(-1), { radius: ultimo.precisao || 10, color: cor('--serie-1'), weight: 1, fillOpacity: 0.12 }).addTo(g.mapa);
    const marca = L.circleMarker(pontos.at(-1), { radius: 7, color: cor('--superficie'), weight: 2, fillColor: cor('--serie-1'), fillOpacity: 1 })
      .bindTooltip(`Última posição · ±${fmtNum(ultimo.precisao, 0)} m`).addTo(g.mapa);
    g.camadas = [linha, precisao, marca];
    if (!g.enquadrado) { g.mapa.fitBounds(L.latLngBounds(pontos).pad(0.3), { maxZoom: 17 }); g.enquadrado = true; }
    setTimeout(() => g.mapa.invalidateSize(), 0);
  }

  function preencherTabela(g, s, linhas, minutos) {
    const ultimas = linhas.slice(-50).reverse();
    const campos = [...new Set(ultimas.flatMap((r) => Object.keys(r.d)))];
    g.el.querySelector('.tabela-rolagem').innerHTML = `<table>
      <thead><tr><th>Hora</th>${campos.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${ultimas.map((r) => `<tr><td>${fmtHora(r.t, minutos)}</td>${campos.map((c) => `<td>${typeof r.d[c] === 'boolean' ? (r.d[c] ? 'sim' : 'não') : esc(r.d[c] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
  }

  function baixarCsv() {
    const linhas = [];
    for (const s of SENSORES) for (const r of dados[s.id] || []) linhas.push({ medido_em: new Date(r.t).toISOString(), sensor: s.id, ...r.d });
    linhas.sort((a, b) => a.medido_em.localeCompare(b.medido_em));
    const colunas = [...new Set(linhas.flatMap(Object.keys))];
    const celula = (v) => (v == null ? '' : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [colunas.join(','), ...linhas.map((l) => colunas.map((c) => celula(l[c])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `sensores-${new Date().toISOString().slice(0, 16).replace(':', 'h')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function apagarDados() {
    const sel = $('dash-aparelho');
    const nome = sel.options[sel.selectedIndex]?.text || 'este aparelho';
    if (!confirm(`Apagar TODAS as leituras de ${nome}? Isso não pode ser desfeito.`)) return;
    const { error } = await sb.from('leituras').delete().eq('aparelho_id', sel.value);
    if (error) alert('Erro ao apagar: ' + error.message);
    await atualizar();
  }

  function redesenharTudo() {
    for (const g of Object.values(graficos)) { g.chart?.destroy(); g.mapa?.remove(); g.el.remove(); }
    for (const k of Object.keys(graficos)) delete graficos[k];
    atualizar();
  }

  function agendar() {
    clearInterval(relogio);
    if ($('dash-auto').checked) relogio = setInterval(() => { if (!document.hidden) atualizar(); }, 10000);
  }

  $('dash-aparelho').addEventListener('change', redesenharTudo);
  $('dash-periodo').addEventListener('change', redesenharTudo);
  $('dash-atualizar').addEventListener('click', atualizar);
  $('dash-auto').addEventListener('change', agendar);
  $('baixar-csv').addEventListener('click', baixarCsv);
  $('apagar-dados').addEventListener('click', apagarDados);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redesenharTudo);

  return {
    async abrir() {
      await carregarAparelhos();
      await atualizar();
      Object.values(graficos).forEach((g) => g.mapa?.invalidateSize());
      agendar();
    },
    fechar() { clearInterval(relogio); },
  };
}
