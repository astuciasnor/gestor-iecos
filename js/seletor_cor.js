// Seletor de cor da componente (redesenho da aba Alocar Componentes).
//
// O valor continua no <input type="color" id="inp-color"> (o resto do app le e
// grava ali, e e esse hex que vai para o banco). Este modulo so poe por cima:
//  - um circulo (#cd-cor-btn) com o tom suave da cor atual e um anel na cor forte;
//  - um menu com as 15 cores da paleta (salva-se a cor forte) e "Outro..."
//    (abre o seletor nativo do navegador).
// Escolher uma cor dispara 'input' e 'change' no campo, como se o usuario tivesse
// usado o seletor antigo; assim a grade se atualiza sozinha.

import { PALETA_CORES, tonsDaCor, normalizeHexColor } from './color_utils.js?v=202611102224';

export function setupSeletorCor() {
    const input = document.getElementById('inp-color');
    const botao = document.getElementById('cd-cor-btn');
    if (!input || !botao || botao.dataset.pronto) return;
    botao.dataset.pronto = '1';

    // Menu montado uma vez e preso ao <body> (posicao fixa): fica por cima da
    // barra lateral sem ser cortado pela rolagem dela.
    const menu = document.createElement('div');
    menu.id = 'cd-cor-menu';
    menu.className = 'cd-cor-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Cor da componente');
    menu.hidden = true;

    const grade = document.createElement('div');
    grade.className = 'cd-cor-grade';
    const amostras = PALETA_CORES.map(([nome, fundo, borda]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cd-cor-amostra';
        b.title = nome;
        b.setAttribute('aria-label', nome);
        b.style.background = fundo;
        b.style.borderColor = borda;
        b.dataset.cor = borda.toLowerCase();
        b.addEventListener('click', () => {
            escolher(b.dataset.cor);
            fechar(true);
        });
        grade.appendChild(b);
        return b;
    });
    menu.appendChild(grade);

    const divisoria = document.createElement('div');
    divisoria.className = 'cd-cor-divisoria';
    menu.appendChild(divisoria);

    const outro = document.createElement('button');
    outro.type = 'button';
    outro.className = 'cd-cor-outro';
    outro.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v8"></path><path d="M8 12h8"></path></svg>Outro… (vira tom suave sozinho)';
    outro.addEventListener('click', () => {
        fechar(false);
        // Seletor nativo: o proprio campo dispara input/change ao escolher
        if (typeof input.showPicker === 'function') {
            try { input.showPicker(); return; } catch (_) { /* cai no click */ }
        }
        input.click();
    });
    menu.appendChild(outro);
    document.body.appendChild(menu);

    // Pinta o circulo e marca a amostra atual
    const atualizar = () => {
        const hex = normalizeHexColor(input.value, '#64748b');
        const t = tonsDaCor(hex);
        botao.style.setProperty('--bloco-fundo', t.fundo);
        botao.style.setProperty('--bloco-borda', t.borda);
        amostras.forEach((b) => {
            const sel = b.dataset.cor === hex;
            b.classList.toggle('is-selecionada', sel);
            b.setAttribute('aria-pressed', sel ? 'true' : 'false');
        });
    };

    const escolher = (hex) => {
        input.value = hex;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const posicionar = () => {
        const r = botao.getBoundingClientRect();
        const largura = menu.offsetWidth || 300;
        const left = Math.max(8, Math.min(r.left, window.innerWidth - largura - 8));
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(r.bottom + 8)}px`;
    };

    const abrir = () => {
        menu.hidden = false;
        botao.setAttribute('aria-expanded', 'true');
        posicionar();
        (menu.querySelector('.is-selecionada') || amostras[0]).focus();
    };

    function fechar(devolverFoco) {
        if (menu.hidden) return;
        menu.hidden = true;
        botao.setAttribute('aria-expanded', 'false');
        if (devolverFoco) botao.focus();
    }

    botao.addEventListener('click', () => (menu.hidden ? abrir() : fechar(true)));
    document.addEventListener('click', (e) => {
        if (menu.hidden || menu.contains(e.target) || botao.contains(e.target)) return;
        fechar(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !menu.hidden) fechar(true);
    });
    window.addEventListener('resize', () => { if (!menu.hidden) posicionar(); });
    document.querySelector('.sidebar')?.addEventListener('scroll', () => fechar(false), { passive: true });

    // O app troca input.value direto (sem evento) ao escolher ou editar uma
    // componente. Interceptamos o "value" deste campo para o circulo acompanhar.
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc?.set && desc?.get) {
        Object.defineProperty(input, 'value', {
            configurable: true,
            get() { return desc.get.call(this); },
            set(v) { desc.set.call(this, v); atualizar(); }
        });
    }
    input.addEventListener('input', atualizar);
    input.addEventListener('change', atualizar);
    atualizar();
}
