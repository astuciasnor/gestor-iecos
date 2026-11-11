// Lista de sugestoes de docentes do Cardume (no lugar do <datalist> do navegador).
// Acha o nome com ou sem acento, nos dois sentidos: "Laz" acha "Lázaro" e
// "Láz" acha "Lazaro". Mostra uma linha por professor, com o nome da lista.
// filtrarDocentes e pura (testada em tests/sugestoes_docente.test.mjs); a parte
// de tela so roda quando ligarSugestoesDocente e chamada.
import { normalizeTeacherNameForMatch } from './docente_nomes.mjs?v=202611102226';

// Nomes que tem TODAS as partes digitadas, em qualquer ordem ("marcos laz").
// Primeiro os que comecam pelo que foi digitado, depois os que tem uma palavra
// comecando assim, depois o resto; em cada grupo, ordem alfabetica.
export function filtrarDocentes(digitado, nomes = [], max = 50) {
    const lista = (Array.isArray(nomes) ? nomes : []).filter(Boolean);
    const termo = normalizeTeacherNameForMatch(digitado);
    const ordenar = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
    if (!termo) return lista.slice().sort(ordenar).slice(0, max);
    const partes = termo.split(' ');
    const grupo = (chave) => {
        if (chave.startsWith(termo)) return 0;
        if (chave.split(' ').some((p) => p.startsWith(partes[0]))) return 1;
        return 2;
    };
    return lista
        .map((nome) => ({ nome, chave: normalizeTeacherNameForMatch(nome) }))
        .filter(({ chave }) => partes.every((p) => chave.includes(p)))
        .sort((a, b) => grupo(a.chave) - grupo(b.chave) || ordenar(a.nome, b.nome))
        .slice(0, max)
        .map(({ nome }) => nome);
}

// Liga a lista a todos os campos que casam com o seletor (inclusive os criados
// depois, como as linhas de "Multiplos"). Escolher um nome poe o valor no campo
// e dispara input e change, como o datalist fazia.
export function ligarSugestoesDocente({ seletor, getNomes }) {
    const lista = document.createElement('ul');
    lista.className = 'sug-docente no-print';
    lista.setAttribute('role', 'listbox');
    lista.hidden = true;
    document.body.appendChild(lista);

    let campo = null;
    let itens = [];
    let ativo = -1;

    const fechar = () => {
        lista.hidden = true;
        campo = null;
        itens = [];
        ativo = -1;
    };
    const posicionar = () => {
        if (!campo || lista.hidden) return;
        const r = campo.getBoundingClientRect();
        lista.style.left = `${Math.max(4, r.left)}px`;
        lista.style.top = `${r.bottom + 2}px`;
        lista.style.minWidth = `${r.width}px`;
    };
    const marcar = (i) => {
        ativo = i;
        [...lista.children].forEach((li, k) => li.classList.toggle('ativo', k === i));
        if (i >= 0) lista.children[i]?.scrollIntoView({ block: 'nearest' });
    };
    const escolher = (i) => {
        const alvo = campo;
        const nome = itens[i];
        if (!alvo || !nome) return;
        alvo.value = nome;
        alvo.dispatchEvent(new Event('input', { bubbles: true }));
        alvo.dispatchEvent(new Event('change', { bubbles: true }));
        fechar();
    };
    const abrir = (input) => {
        campo = input;
        itens = filtrarDocentes(input.value, getNomes());
        // O nome ja escolhido nao precisa de lista.
        if (!itens.length || (itens.length === 1 && itens[0] === input.value)) {
            lista.hidden = true;
            return;
        }
        lista.innerHTML = '';
        itens.forEach((nome, k) => {
            const li = document.createElement('li');
            li.textContent = nome;
            li.setAttribute('role', 'option');
            // mousedown (e nao click): o campo nao perde o foco antes da escolha.
            li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                escolher(k);
            });
            lista.appendChild(li);
        });
        lista.hidden = false;
        lista.scrollTop = 0;
        // Nada pre-marcado: Enter num nome novo nao troca pelo da lista.
        marcar(-1);
        posicionar();
    };
    const casa = (el) => el instanceof HTMLInputElement && el.matches(seletor);

    document.addEventListener('focusin', (e) => { if (casa(e.target)) abrir(e.target); });
    document.addEventListener('input', (e) => { if (casa(e.target)) abrir(e.target); });
    document.addEventListener('focusout', (e) => { if (e.target === campo) fechar(); });
    document.addEventListener('keydown', (e) => {
        if (e.target !== campo || lista.hidden) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = itens.length;
            marcar(e.key === 'ArrowDown' ? (ativo + 1) % n : (ativo <= 0 ? n - 1 : ativo - 1));
        } else if (e.key === 'Enter' && ativo >= 0) {
            e.preventDefault();
            escolher(ativo);
        } else if (e.key === 'Escape') {
            fechar();
        }
    });
    window.addEventListener('scroll', posicionar, true);
    window.addEventListener('resize', posicionar);
}
