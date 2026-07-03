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
