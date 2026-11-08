export function normalizeHexColor(color, fallback = '#f39c12') {
    const src = String(color || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(src)) return src.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(src)) {
        return `#${src[1]}${src[1]}${src[2]}${src[2]}${src[3]}${src[3]}`.toLowerCase();
    }
    return fallback;
}

export function hexToRgb(hexColor) {
    const hex = normalizeHexColor(hexColor);
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16)
    };
}

export function adjustHexColor(hexColor, delta) {
    const { r, g, b } = hexToRgb(hexColor);
    const clamp = (v) => Math.max(0, Math.min(255, v));
    const toHex = (v) => clamp(v).toString(16).padStart(2, '0');
    return `#${toHex(r + delta)}${toHex(g + delta)}${toHex(b + delta)}`;
}

export function hexToRgba(hexColor, alpha = 1) {
    const { r, g, b } = hexToRgb(hexColor);
    const a = Math.max(0, Math.min(1, alpha));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d) + (g < b ? 6 : 0); break;
            case g: h = ((b - r) / d) + 2; break;
            default: h = ((r - g) / d) + 4; break;
        }
        h /= 6;
    }
    return { h, s, l };
}

export function hslToRgb(h, s, l) {
    let r;
    let g;
    let b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return { r: r * 255, g: g * 255, b: b * 255 };
}

// Realca a cor (boost de croma): pasteis muito claros viram tons mais cheios,
// para que os cards da Grade Semanal e o seletor "encham os olhos" como o
// Calendario Mensal. Idempotente: cores ja vivas mapeiam para ~si mesmas.
export function vividHexColor(hexColor, fallback = '#f39c12') {
    const base = normalizeHexColor(hexColor, fallback);
    const { r, g, b } = hexToRgb(base);
    const hsl = rgbToHsl(r, g, b);
    // Cinzas/quase neutros ficam de fora para nao ganharem cor artificial.
    if (hsl.s < 0.08) return base;
    const s = Math.min(1, hsl.s * 1.12 + 0.06);
    let l = hsl.l;
    const maxL = 0.70;
    if (l > maxL) l = maxL - (l - maxL) * 0.25; // comprime o excesso de luminancia dos pasteis
    // Faixa de luminancia que mantem a cor vibrante e o texto preto legivel (contraste >= 4.3).
    l = Math.max(0.55, Math.min(maxL, l));
    const out = hslToRgb(hsl.h, s, l);
    const toHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${toHex(out.r)}${toHex(out.g)}${toHex(out.b)}`;
}

// ---------------------------------------------------------------------------
// Tons suaves (redesenho da aba Alocar Componentes)
// O banco continua guardando UM hex por componente. Na hora de desenhar, cada
// cor vira tres tons: fundo suave, borda (barra) forte e texto escuro.
// ---------------------------------------------------------------------------

// Paleta curada: [nome, fundo, borda forte, texto]
export const PALETA_CORES = [
    ['Vermelho', '#FEE2E2', '#DC2626', '#7F1D1D'],
    ['Laranja', '#FFEDD5', '#EA580C', '#7C2D12'],
    ['Âmbar', '#FEF3C7', '#D97706', '#78350F'],
    ['Amarelo', '#FEF9C3', '#CA8A04', '#713F12'],
    ['Lima', '#ECFCCB', '#65A30D', '#365314'],
    ['Verde', '#DCFCE7', '#16A34A', '#14532D'],
    ['Esmeralda', '#D1FAE5', '#059669', '#064E3B'],
    ['Turquesa', '#CCFBF1', '#0D9488', '#134E4A'],
    ['Ciano', '#CFFAFE', '#0891B2', '#164E63'],
    ['Céu', '#E0F2FE', '#0284C7', '#0C4A6E'],
    ['Azul', '#DBEAFE', '#2563EB', '#1E3A8A'],
    ['Anil', '#E0E7FF', '#4F46E5', '#312E81'],
    ['Violeta', '#EDE9FE', '#7C3AED', '#4C1D95'],
    ['Magenta', '#FAE8FF', '#C026D3', '#701A75'],
    ['Rosa', '#FCE7F3', '#DB2777', '#831843']
];

// Busca rapida pela cor forte (chave em maiusculas)
const PALETA_SUAVE = Object.fromEntries(PALETA_CORES.map(([, fundo, borda, texto]) => [borda, { fundo, borda, texto }]));

// Matiz (0-360) e saturacao (0-100) de "#RGB" ou "#RRGGBB"
export function matizESaturacao(hex) {
    const { r, g, b } = hexToRgb(hex);
    const hsl = rgbToHsl(r, g, b);
    return { matiz: Math.round(hsl.h * 360) % 360, sat: Math.round(hsl.s * 100) };
}

// Devolve { fundo, borda, texto } para qualquer cor salva: as da paleta usam os
// tons curados; as demais (pasteis antigos, cores livres) sao derivadas pela matiz.
export function tonsDaCor(hex) {
    const valido = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(hex || '').trim());
    const base = valido ? normalizeHexColor(hex) : '#64748b';
    const chave = base.toUpperCase();
    if (PALETA_SUAVE[chave]) return { ...PALETA_SUAVE[chave] };
    const { matiz, sat } = matizESaturacao(base);
    // Cinzas continuam cinzas; cores vivas tem a saturacao limitada para nao "gritar"
    const s = sat < 10 ? sat : Math.min(Math.max(sat, 45), 85);
    return {
        fundo: `hsl(${matiz} ${Math.min(s, 85)}% 93%)`,
        borda: `hsl(${matiz} ${Math.min(s, 75)}% 40%)`,
        texto: `hsl(${matiz} ${Math.min(s, 70)}% 20%)`
    };
}

// Aplica os tons como variaveis CSS no elemento (o CSS usa --bloco-*)
export function aplicarTonsBloco(el, hex) {
    if (!el) return;
    const t = tonsDaCor(hex);
    el.style.setProperty('--bloco-fundo', t.fundo);
    el.style.setProperty('--bloco-borda', t.borda);
    el.style.setProperty('--bloco-texto', t.texto);
}

// Os mesmos tons em texto, para HTML montado em string: style="${estiloTonsBloco(cor)}"
export function estiloTonsBloco(hex) {
    const t = tonsDaCor(hex);
    return `--bloco-fundo:${t.fundo}; --bloco-borda:${t.borda}; --bloco-texto:${t.texto};`;
}
