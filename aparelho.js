// Identifica marca, modelo, sistema e navegador do aparelho.

// Prefixo do código de modelo Android -> marca
const MARCAS_ANDROID = [
  [/^(SM-|GT-|SC-|SCG|SGH-|Galaxy)/i, 'Samsung'],
  [/^(moto|motorola|XT\d)/i, 'Motorola'],
  [/^Pixel/i, 'Google'],
  [/^(Redmi|POCO|Mi |Xiaomi|M2\d{3}|2\d{3}[0-9A-Z]{4,}$|\d{5}[0-9A-Z]{3,}$)/i, 'Xiaomi'],
  [/^RMX/i, 'realme'],
  [/^(CPH|OPPO|PH[A-Z]\d)/i, 'OPPO'],
  [/^(ONEPLUS|IN20|KB20|LE21|NE22)/i, 'OnePlus'],
  [/^(V2\d{3}|vivo)/i, 'vivo'],
  [/^(LM-|LG)/i, 'LG'],
  [/^(ASUS|ZS\d|AI2\d)/i, 'ASUS'],
  [/^(SO-|XQ-|Xperia)/i, 'Sony'],
  [/^(HUAWEI|[A-Z]{3}-(L|AL|TL|LX)\d)/i, 'Huawei'],
  [/^(Nokia|TA-1)/i, 'Nokia'],
  [/^Infinix/i, 'Infinix'],
  [/^TECNO/i, 'TECNO'],
  [/^Positivo/i, 'Positivo'],
  [/^(Multilaser|ML-)/i, 'Multilaser'],
];

// Linhas Samsung pelo prefixo do código (ex.: SM-S918B -> Galaxy S)
const LINHAS_SAMSUNG = [
  [/^SM-S9/i, 'Galaxy S'], [/^SM-G9/i, 'Galaxy S'], [/^SM-A/i, 'Galaxy A'],
  [/^SM-M/i, 'Galaxy M'], [/^SM-F9[0-9][0-9]/i, 'Galaxy Z Fold/Flip'],
  [/^SM-N/i, 'Galaxy Note'], [/^SM-E/i, 'Galaxy F/E'], [/^SM-X|^SM-T|^SM-P/i, 'Galaxy Tab'],
];

// iPhone: o navegador não informa o modelo. Estimamos pela tela (largura x altura em pontos, densidade).
const IPHONES = [
  ['320x568@2', 'iPhone SE (1ª geração) / 5s'],
  ['375x667@2', 'iPhone SE (2ª/3ª geração) / 6 / 7 / 8'],
  ['414x736@3', 'iPhone 6 Plus / 7 Plus / 8 Plus'],
  ['375x812@3', 'iPhone X / XS / 11 Pro / 12 mini / 13 mini'],
  ['414x896@2', 'iPhone XR / 11'],
  ['414x896@3', 'iPhone XS Max / 11 Pro Max'],
  ['390x844@3', 'iPhone 12 / 12 Pro / 13 / 13 Pro / 14 / 16e'],
  ['428x926@3', 'iPhone 12 Pro Max / 13 Pro Max / 14 Plus'],
  ['393x852@3', 'iPhone 14 Pro / 15 / 15 Pro / 16'],
  ['430x932@3', 'iPhone 14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus'],
  ['402x874@3', 'iPhone 16 Pro / 17 / 17 Pro'],
  ['420x912@3', 'iPhone Air'],
  ['440x956@3', 'iPhone 16 Pro Max / 17 Pro Max'],
];

function estimarIphone() {
  const w = Math.min(screen.width, screen.height);
  const h = Math.max(screen.width, screen.height);
  const chave = `${w}x${h}@${Math.round(window.devicePixelRatio || 1)}`;
  const achado = IPHONES.find(([k]) => k === chave);
  return achado ? achado[1] : `iPhone (tela ${w}×${h})`;
}

function detectarNavegador(ua) {
  const regras = [
    [/SamsungBrowser\/(\d+)/, 'Samsung Internet'], [/EdgA?\/(\d+)/, 'Edge'],
    [/(?:CriOS|Chrome)\/(\d+)/, 'Chrome'], [/(?:FxiOS|Firefox)\/(\d+)/, 'Firefox'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
  ];
  for (const [re, nome] of regras) {
    const m = ua.match(re);
    if (m) return `${nome} ${m[1]}`;
  }
  return 'Desconhecido';
}

export async function detectarAparelho() {
  const ua = navigator.userAgent;
  const info = {
    marca: null, modelo: null, modelo_estimado: false,
    sistema: null, navegador: detectarNavegador(ua), user_agent: ua, nota: null,
  };

  // Client Hints: no Chrome/Android informam o código do modelo e a versão do sistema
  let dicas = null;
  if (navigator.userAgentData?.getHighEntropyValues) {
    try {
      dicas = await navigator.userAgentData.getHighEntropyValues(['model', 'platform', 'platformVersion']);
    } catch { /* sem dicas */ }
  }

  const ehIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (ehIOS) {
    info.marca = 'Apple';
    const versao = (ua.match(/OS (\d+[_\d]*)/) || [])[1];
    info.sistema = 'iOS' + (versao ? ' ' + versao.replace(/_/g, '.') : '');
    if (/iPad/.test(ua) || navigator.platform === 'MacIntel') {
      info.modelo = 'iPad';
    } else {
      info.modelo = estimarIphone();
      info.modelo_estimado = true;
      info.nota = 'A Apple não deixa o navegador informar o modelo exato. Estimado pelo tamanho da tela.';
    }
  } else if (/Android/.test(ua)) {
    info.sistema = 'Android ' + (dicas?.platformVersion || (ua.match(/Android ([\d.]+)/) || [])[1] || '');
    let codigo = dicas?.model || '';
    if (!codigo) {
      const m = ua.match(/Android [\d.]+; ([^;)]+)/);
      if (m && !/^(K|Mobile|wv)$/i.test(m[1].trim())) codigo = m[1].replace(/ Build\/.*/, '').trim();
    }
    if (codigo) {
      const marca = MARCAS_ANDROID.find(([re]) => re.test(codigo));
      info.marca = marca ? marca[1] : null;
      info.modelo = codigo;
      if (info.marca === 'Samsung') {
        const linha = LINHAS_SAMSUNG.find(([re]) => re.test(codigo));
        if (linha) info.nota = `Linha ${linha[1]} (código ${codigo}).`;
      }
      if (!info.marca) info.nota = 'Marca não reconhecida pelo código do modelo.';
    } else {
      info.modelo = 'Android (modelo oculto)';
      info.nota = 'Este navegador esconde o modelo. Abra no Chrome para ver marca e modelo.';
    }
  } else {
    const plataforma = dicas?.platform || navigator.platform || '';
    info.sistema = /Mac/i.test(plataforma) ? 'macOS' : /Win/i.test(plataforma) ? 'Windows'
      : /Linux/i.test(plataforma) ? 'Linux' : plataforma || 'Desconhecido';
    info.modelo = 'Computador';
    info.nota = 'Computadores normalmente não têm sensores de movimento. Abra este endereço no celular para coletar.';
  }

  info.nome = [info.marca, info.modelo].filter(Boolean).join(' ');
  return info;
}
