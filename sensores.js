// Catálogo de sensores que o navegador consegue ler: detecção, coleta e resumo por intervalo.

const num = (v, casas = 2) => (typeof v === 'number' && isFinite(v) ? +v.toFixed(casas) : null);
const fmt = (v, casas = 1) => (v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: casas }));

function esperarEvento(tipo, valido, ms) {
  return new Promise((resolve) => {
    const fim = setTimeout(() => { window.removeEventListener(tipo, ouvir); resolve(null); }, ms);
    function ouvir(e) {
      if (!valido(e)) return;
      clearTimeout(fim);
      window.removeEventListener(tipo, ouvir);
      resolve(e);
    }
    window.addEventListener(tipo, ouvir);
  });
}

async function estadoPermissao(nome) {
  try { return (await navigator.permissions.query({ name: nome })).state; } catch { return null; }
}

// iPhone exige pedir permissão de movimento dentro de um toque do usuário.
// Chame ANTES de qualquer outro await no clique.
export function pedirPermissaoMovimento() {
  const pedidos = [];
  if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) pedidos.push(DeviceMotionEvent.requestPermission());
  if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) pedidos.push(DeviceOrientationEvent.requestPermission());
  if (!pedidos.length) return Promise.resolve('nao-precisa');
  return Promise.all(pedidos)
    .then((r) => (r.every((x) => x === 'granted') ? 'granted' : 'denied'))
    .catch(() => 'denied');
}
export const precisaToqueParaMovimento = () =>
  typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';

// Acumula médias de campos numéricos até a próxima amostra.
class Media {
  constructor(campos) { this.campos = campos; this.zerar(); }
  zerar() { this.soma = {}; this.n = 0; this.max = 0; }
  somar(obj, intensidade) {
    if (this.campos.some((c) => typeof obj[c] !== 'number')) return;
    for (const c of this.campos) this.soma[c] = (this.soma[c] || 0) + obj[c];
    this.n++;
    if (intensidade != null) this.max = Math.max(this.max, intensidade);
  }
  tirar() {
    if (!this.n) return null;
    const r = {};
    for (const c of this.campos) r[c] = num(this.soma[c] / this.n);
    r._max = num(this.max);
    this.zerar();
    return r;
  }
}

// ---------- Movimento (acelerômetro + giroscópio compartilham o mesmo evento) ----------
const mediaAcel = new Media(['x', 'y', 'z']);
const mediaGiro = new Media(['alpha', 'beta', 'gamma']);
let ouvintesMovimento = 0;
function aoMover(e) {
  const a = e.accelerationIncludingGravity;
  if (a && a.x != null) mediaAcel.somar(a, Math.hypot(a.x, a.y, a.z));
  const r = e.rotationRate;
  if (r && r.alpha != null) mediaGiro.somar(r, Math.hypot(r.alpha, r.beta, r.gamma));
}
function ligarMovimento() { if (ouvintesMovimento++ === 0) window.addEventListener('devicemotion', aoMover); }
function desligarMovimento() { if (--ouvintesMovimento === 0) window.removeEventListener('devicemotion', aoMover); }

let sondaMovimento = null; // promessa da última detecção de movimento (compartilhada)
async function sondarMovimento() {
  if (typeof DeviceMotionEvent === 'undefined') return { acel: false, giro: false };
  const e = await esperarEvento('devicemotion',
    (ev) => ev.accelerationIncludingGravity?.x != null || ev.rotationRate?.alpha != null, 2000);
  return {
    acel: !!(e && e.accelerationIncludingGravity?.x != null),
    giro: !!(e && e.rotationRate?.alpha != null),
  };
}

// ---------- Sensores genéricos (luz, magnetômetro) ----------
function testarGenerico(Classe, opcoes = {}) {
  return new Promise((resolve) => {
    let s;
    const fim = setTimeout(() => { try { s?.stop(); } catch {} resolve(false); }, 2000);
    try {
      s = new Classe({ frequency: 1, ...opcoes });
      s.onreading = () => { clearTimeout(fim); s.stop(); resolve(true); };
      s.onerror = () => { clearTimeout(fim); resolve(false); };
      s.start();
    } catch { clearTimeout(fim); resolve(false); }
  });
}

const sensorGenerico = (nomeClasse, campos) => {
  let s = null; let ultimo = null;
  return {
    async detectar() {
      if (!(nomeClasse in window)) return { estado: 'indisponivel', motivo: 'Navegador não libera este sensor.' };
      return (await testarGenerico(window[nomeClasse]))
        ? { estado: 'disponivel' }
        : { estado: 'indisponivel', motivo: 'Sensor ausente ou bloqueado.' };
    },
    async iniciar() {
      s = new window[nomeClasse]({ frequency: 2 });
      s.onreading = () => { ultimo = {}; for (const c of campos) ultimo[c] = num(s[c]); };
      s.start();
    },
    parar() { try { s?.stop(); } catch {} s = null; ultimo = null; },
    amostra() { return ultimo; },
  };
};

// ---------- Catálogo ----------
export const SENSORES = [
  {
    id: 'acelerometro', nome: 'Acelerômetro', icone: '📐',
    desc: 'Movimento e inclinação do aparelho (inclui a gravidade).', unidade: 'm/s²',
    async detectar() {
      const r = await (sondaMovimento ||= sondarMovimento());
      return r.acel ? { estado: 'disponivel' } : { estado: 'indisponivel', motivo: 'Sem leituras de movimento.' };
    },
    async iniciar() { mediaAcel.zerar(); ligarMovimento(); },
    parar() { desligarMovimento(); },
    amostra() {
      const m = mediaAcel.tirar();
      return m && { x: m.x, y: m.y, z: m.z, intensidade_max: m._max };
    },
    texto: (d) => `x ${fmt(d.x)}  y ${fmt(d.y)}  z ${fmt(d.z)}\npico ${fmt(d.intensidade_max)} m/s²`,
  },
  {
    id: 'giroscopio', nome: 'Giroscópio', icone: '🔄',
    desc: 'Velocidade de rotação em cada eixo.', unidade: '°/s',
    async detectar() {
      const r = await (sondaMovimento ||= sondarMovimento());
      return r.giro ? { estado: 'disponivel' } : { estado: 'indisponivel', motivo: 'Sem leituras de rotação.' };
    },
    async iniciar() { mediaGiro.zerar(); ligarMovimento(); },
    parar() { desligarMovimento(); },
    amostra() {
      const m = mediaGiro.tirar();
      return m && { alpha: m.alpha, beta: m.beta, gamma: m.gamma, rotacao_max: m._max };
    },
    texto: (d) => `α ${fmt(d.alpha)}  β ${fmt(d.beta)}  γ ${fmt(d.gamma)}\npico ${fmt(d.rotacao_max)} °/s`,
  },
  (() => {
    let ultimo = null; let bussola = null;
    // Ouve os dois eventos: o comum (ângulos) e o "absoluto" do Android (aponta para o norte)
    const ouvir = (e) => {
      if (e.alpha == null && e.beta == null) return;
      if (typeof e.webkitCompassHeading === 'number') bussola = e.webkitCompassHeading; // iPhone
      else if (e.absolute && e.alpha != null) bussola = (360 - e.alpha) % 360;
      ultimo = { alpha: num(e.alpha, 1), beta: num(e.beta, 1), gamma: num(e.gamma, 1), bussola: num(bussola, 0) };
    };
    return {
      id: 'orientacao', nome: 'Orientação e bússola', icone: '🧭',
      desc: 'Ângulos do aparelho e direção do norte (quando disponível).', unidade: '°',
      async detectar() {
        if (typeof DeviceOrientationEvent === 'undefined') return { estado: 'indisponivel', motivo: 'Navegador sem orientação.' };
        const e = await esperarEvento('deviceorientation', (ev) => ev.alpha != null || ev.beta != null, 2000);
        return e ? { estado: 'disponivel' } : { estado: 'indisponivel', motivo: 'Sem leituras de orientação.' };
      },
      async iniciar() {
        window.addEventListener('deviceorientation', ouvir);
        window.addEventListener('deviceorientationabsolute', ouvir);
      },
      parar() {
        window.removeEventListener('deviceorientation', ouvir);
        window.removeEventListener('deviceorientationabsolute', ouvir);
        ultimo = bussola = null;
      },
      amostra() { return ultimo; },
      texto: (d) => `inclinação β ${fmt(d.beta, 0)}°  γ ${fmt(d.gamma, 0)}°\nbússola ${d.bussola == null ? '—' : fmt(d.bussola, 0) + '°'}`,
    };
  })(),
  (() => {
    let vigia = null; let ultimo = null;
    return {
      id: 'localizacao', nome: 'Localização (GPS)', icone: '📍',
      desc: 'Latitude, longitude, altitude e velocidade.', unidade: '',
      async detectar() {
        if (!('geolocation' in navigator)) return { estado: 'indisponivel', motivo: 'Navegador sem localização.' };
        const p = await estadoPermissao('geolocation');
        if (p === 'denied') return { estado: 'indisponivel', motivo: 'Bloqueada nas configurações do navegador.' };
        return p === 'granted' ? { estado: 'disponivel' } : { estado: 'permissao', motivo: 'Vai pedir permissão ao iniciar.' };
      },
      iniciar() {
        return new Promise((resolve, reject) => {
          let primeira = true;
          const fim = setTimeout(() => { primeira = false; resolve(); }, 15000);
          vigia = navigator.geolocation.watchPosition((pos) => {
            const c = pos.coords;
            ultimo = {
              lat: num(c.latitude, 6), lon: num(c.longitude, 6), precisao: num(c.accuracy, 0),
              altitude: num(c.altitude, 1), velocidade: c.speed == null ? null : num(c.speed * 3.6, 1),
            };
            if (primeira) { primeira = false; clearTimeout(fim); resolve(); }
          }, (err) => {
            if (primeira && err.code === 1) { primeira = false; clearTimeout(fim); reject(new Error('Permissão de localização negada.')); }
          }, { enableHighAccuracy: true, maximumAge: 0 });
        });
      },
      parar() { if (vigia != null) navigator.geolocation.clearWatch(vigia); vigia = null; ultimo = null; },
      amostra() { return ultimo; },
      texto: (d) => `${fmt(d.lat, 5)}, ${fmt(d.lon, 5)}\n±${fmt(d.precisao, 0)} m${d.velocidade != null ? ' · ' + fmt(d.velocidade) + ' km/h' : ''}`,
    };
  })(),
  (() => {
    let bateria = null;
    return {
      id: 'bateria', nome: 'Bateria', icone: '🔋',
      desc: 'Nível de carga e se está carregando.', unidade: '%',
      async detectar() {
        if (!navigator.getBattery) return { estado: 'indisponivel', motivo: 'Navegador não informa a bateria.' };
        try { await navigator.getBattery(); return { estado: 'disponivel' }; } catch { return { estado: 'indisponivel' }; }
      },
      async iniciar() { bateria = await navigator.getBattery(); },
      parar() { bateria = null; },
      amostra() { return bateria && { nivel: Math.round(bateria.level * 100), carregando: bateria.charging }; },
      texto: (d) => `${d.nivel}%${d.carregando ? ' ⚡ carregando' : ''}`,
    };
  })(),
  (() => {
    let fluxo = null; let ctx = null; let relogio = null; let soma = 0; let n = 0; let max = 0;
    return {
      id: 'som', nome: 'Microfone (nível de som)', icone: '🎤',
      desc: 'Só o volume do ambiente, de 0 a 100. Nenhum áudio é gravado.', unidade: '0–100',
      async detectar() {
        if (!navigator.mediaDevices?.getUserMedia) return { estado: 'indisponivel', motivo: 'Navegador sem microfone.' };
        const p = await estadoPermissao('microphone');
        if (p === 'denied') return { estado: 'indisponivel', motivo: 'Bloqueado nas configurações do navegador.' };
        return p === 'granted' ? { estado: 'disponivel' } : { estado: 'permissao', motivo: 'Vai pedir permissão ao iniciar.' };
      },
      // O áudio precisa ser criado ainda dentro do toque (exigência do iPhone)
      preparar() {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        ctx.resume();
      },
      async iniciar() {
        fluxo = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        ctx ||= new (window.AudioContext || window.webkitAudioContext)();
        await ctx.resume();
        const analisador = ctx.createAnalyser();
        analisador.fftSize = 2048;
        ctx.createMediaStreamSource(fluxo).connect(analisador);
        const buf = new Float32Array(analisador.fftSize);
        relogio = setInterval(() => {
          analisador.getFloatTimeDomainData(buf);
          let q = 0; for (const v of buf) q += v * v;
          const db = 20 * Math.log10(Math.sqrt(q / buf.length) || 1e-9); // dBFS: 0 = máximo
          const nivel = Math.max(0, Math.min(100, ((db + 90) / 90) * 100));
          soma += nivel; n++; max = Math.max(max, nivel);
        }, 100);
      },
      parar() {
        clearInterval(relogio); fluxo?.getTracks().forEach((t) => t.stop()); ctx?.close().catch(() => {});
        fluxo = ctx = null; soma = n = max = 0;
      },
      amostra() {
        if (!n) return null;
        const r = { nivel_medio: num(soma / n, 1), nivel_max: num(max, 1) };
        soma = n = max = 0;
        return r;
      },
      texto: (d) => `médio ${fmt(d.nivel_medio, 0)} · pico ${fmt(d.nivel_max, 0)}`,
    };
  })(),
  {
    id: 'rede', nome: 'Rede (conexão)', icone: '📶',
    desc: 'Tipo de conexão, velocidade estimada e latência.', unidade: 'Mbps',
    async detectar() {
      return navigator.connection ? { estado: 'disponivel' } : { estado: 'indisponivel', motivo: 'Navegador não informa a rede.' };
    },
    async iniciar() {},
    parar() {},
    amostra() {
      const c = navigator.connection;
      return c && { online: navigator.onLine, tipo: c.effectiveType || null, downlink: num(c.downlink, 1), rtt: num(c.rtt, 0) };
    },
    texto: (d) => `${d.online ? (d.tipo || '').toUpperCase() : 'offline'} · ${fmt(d.downlink)} Mbps · ${fmt(d.rtt, 0)} ms`,
  },
  {
    id: 'luz', nome: 'Luz ambiente', icone: '💡', desc: 'Iluminação do ambiente.', unidade: 'lux',
    ...sensorGenerico('AmbientLightSensor', ['illuminance']),
    texto: (d) => `${fmt(d.illuminance, 0)} lux`,
  },
  {
    id: 'magnetometro', nome: 'Magnetômetro', icone: '🧲', desc: 'Campo magnético em cada eixo.', unidade: 'µT',
    ...sensorGenerico('Magnetometer', ['x', 'y', 'z']),
    texto: (d) => `x ${fmt(d.x)}  y ${fmt(d.y)}  z ${fmt(d.z)} µT`,
  },
];

export async function detectarTodos() {
  sondaMovimento = null;
  const lista = await Promise.all(SENSORES.map(async (s) => {
    try { return [s.id, await s.detectar()]; } catch { return [s.id, { estado: 'indisponivel' }]; }
  }));
  return Object.fromEntries(lista);
}
