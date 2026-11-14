// Docente novo: o aviso embaixo do campo Docente(s) e a janela "Cadastrar Docente
// Novo" / "Cadastrar Vaga". Saiu do ui.js em 13/11/2026 sem mudar nada; as funcoes
// do editor que ele usa chegam por ligarCadastroDocente (ver ui.js).
import { normalizeTeacherNameForMatch } from './allocation_helpers.js?v=202611141134';
import { OUTRA_UNIDADE, UNIDADES, VINCULOS_DOCENTE_NOVO, acharNomeConhecido, ehVaga, findNewNames, findSimilarNames, limparEspacos, pareceVaga, problemaNoNome, proximaVaga, siglaValida } from './docente_nomes.mjs?v=202611141134';
import { store } from './store.js?v=202611141134';
import { ligarSugestoesDocente } from './sugestoes_docente.mjs?v=202611141134';
import { getPerfil, getSessionEmail } from './sync_remoto.js?v=202611141134';
import { showToastWarning } from './ui_feedback.js?v=202611141134';

// Do ui.js: lista de nomes conhecidos, escape de HTML, ajuste do nome digitado e os campos do editor.
let ligacoes = {};
export function ligarCadastroDocente(fns) {
    ligacoes = fns;
}
// ---- Docente novo: aviso embaixo do campo + "Cadastrar Docente Novo" ----
// Nome fora da lista so e salvo depois de cadastrado na janela (vinculo, unidade
// e subunidade). O cadastro vai junto na alocacao, no campo docentesCadastrados,
// e aparece no painel do administrador ate o nome entrar na planilha.
export const cadastrosDocentes = new Map(); // nome normalizado -> { nome, vinculo, unidade, subunidade, outraUnidade, por, porNome, em }
let avisoDocenteNomes = [];

function getNomesDocenteDigitados() {
    if (document.getElementById('chk-multi-docente')?.checked) {
        return [...document.querySelectorAll('#multi-docente-list .inp-multi-name')].map((inp) => inp.value);
    }
    return [ligacoes.inputConfig.docente?.value || ''];
}

// Nomes digitados que ainda nao estao na lista (ignora maiusculas e acentos).
export function findNewDocenteNames(nomes = getNomesDocenteDigitados()) {
    return findNewNames(nomes, ligacoes.getKnownDocenteNames());
}

export function getCadastroDocente(nome) {
    return cadastrosDocentes.get(normalizeTeacherNameForMatch(nome)) || null;
}

function getUnidadeNome(sigla) {
    return UNIDADES.find((u) => u.sigla === sigla)?.nome || sigla;
}

// 'mostrar': ao sair do campo ou ao tentar salvar. 'ocultar': durante a digitacao
// o aviso so perde nomes, nunca ganha (assim nao fica piscando a cada letra).
export function refreshAvisoDocenteNovo(modo = 'ocultar') {
    const novos = findNewDocenteNames();
    if (modo === 'mostrar') {
        avisoDocenteNomes = novos;
    } else {
        const mostrados = new Set(avisoDocenteNomes.map(normalizeTeacherNameForMatch));
        avisoDocenteNomes = novos.filter((n) => mostrados.has(normalizeTeacherNameForMatch(n)));
    }

    let aviso = document.getElementById('aviso-docente-novo');
    if (!aviso) {
        aviso = document.createElement('div');
        aviso.id = 'aviso-docente-novo';
        aviso.className = 'aviso-docente-novo hidden';
        aviso.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-cadastrar-docente');
            if (btn) abrirCadastroDocente(btn.dataset.nome, { vaga: btn.dataset.vaga === '1' });
        });
    }
    // Um docente: logo abaixo do campo. Varios: abaixo da lista, antes do "Total".
    const multi = document.getElementById('container-multi-docente');
    if (document.getElementById('chk-multi-docente')?.checked && multi) {
        multi.insertBefore(aviso, multi.lastElementChild);
    } else {
        // Depois do bloco do campo, nao dentro: o "x" de limpar se centraliza nele.
        document.getElementById('container-single-docente')?.after(aviso);
    }

    if (!avisoDocenteNomes.length) {
        aviso.classList.add('hidden');
        aviso.innerHTML = '';
        return;
    }
    const esc = ligacoes.escapeTrocaHtml;
    const linhas = avisoDocenteNomes.map((nome) => {
        const cad = getCadastroDocente(nome);
        if (cad) {
            return `<div class="aviso-docente-nome is-ok"><span>✓ <b>${esc(nome)}</b> ${cad.vaga ? 'vaga cadastrada' : 'cadastrado'} (${esc(cad.vinculo)} · ${esc(getUnidadeNome(cad.unidade))} / ${esc(cad.subunidade)})</span></div>`;
        }
        // Nome improvisado ("n.n. substituto", "vaga"...): o caminho e a vaga.
        if (pareceVaga(nome)) {
            return `<div class="aviso-docente-nome"><span><b>${esc(nome)}</b>: docente ainda sem nome?</span><button type="button" class="btn-cadastrar-docente" data-nome="${esc(nome)}" data-vaga="1">Cadastrar Vaga…</button></div>`;
        }
        const problema = problemaNoNome(nome);
        if (problema) {
            return `<div class="aviso-docente-nome"><span><b>${esc(nome)}</b>: ${esc(problema)}</span></div>`;
        }
        return `<div class="aviso-docente-nome"><b>${esc(nome)}</b><button type="button" class="btn-cadastrar-docente" data-nome="${esc(nome)}">Cadastrar Docente Novo…</button></div>`;
    }).join('');
    const pendentes = avisoDocenteNomes.some((nome) => !getCadastroDocente(nome));
    aviso.innerHTML = (pendentes
        ? '<div>⚠ Nome novo no Cardume. Confira se está completo, igual ao SIGAA, e sem abreviações.</div>'
        : '') + linhas;
    aviso.classList.remove('hidden');
}

// Troca o nome no campo Docente (ou na linha certa, com varios docentes).
function trocarNomeDocenteDigitado(antigo, novo) {
    const chave = normalizeTeacherNameForMatch(antigo);
    const campos = document.getElementById('chk-multi-docente')?.checked
        ? [...document.querySelectorAll('#multi-docente-list .inp-multi-name')]
        : [ligacoes.inputConfig.docente].filter(Boolean);
    campos.filter((inp) => normalizeTeacherNameForMatch(inp.value) === chave).forEach((inp) => {
        inp.value = novo;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

function fecharCadastroDocente() {
    document.getElementById('cadastro-docente-modal')?.remove();
    document.removeEventListener('keydown', onCadastroDocenteKeydown);
}

function onCadastroDocenteKeydown(e) {
    if (e.key === 'Escape') fecharCadastroDocente();
}

// Duas situacoes: (1) docente com nome, que esta no SIGAA mas nao na lista do
// Cardume; (2) vaga: a pessoa ainda nao foi definida (substituto a contratar,
// professor nao contatado). Na vaga o Cardume gera o nome ("Vaga1 FACIN").
// Aberta pela primeira linha da lista de docentes ("Cadastrar docente fora da
// lista ou a definir"): o coordenador escolhe o caso, digita o nome so na janela,
// e o nome (ou a vaga gerada) vai direto para o campo clicado (campo).
function abrirCadastroDocente(nome, { vaga = false, campo = null } = {}) {
    fecharCadastroDocente();
    const esc = ligacoes.escapeTrocaHtml;
    const pelaLista = !!campo;
    const parecidos = pelaLista ? [] : findSimilarNames(nome, ligacoes.getKnownDocenteNames());
    // Vagas que ja existem no periodo: a mesma pessoa em outra componente usa a mesma vaga.
    const vagasExistentes = ligacoes.getKnownDocenteNames().filter(ehVaga);
    const overlay = document.createElement('div');
    overlay.id = 'cadastro-docente-modal';
    overlay.className = 'troca-modal no-print';
    overlay.innerHTML = `
        <div class="troca-caixa cad-docente" role="dialog" aria-modal="true" aria-labelledby="cad-docente-titulo">
            <h3 id="cad-docente-titulo">${pelaLista ? 'Cadastrar docente fora da lista' : 'Cadastrar Docente Novo'}</h3>
            ${pelaLista
                ? '<p class="troca-sub">Escolha o caso:</p>'
                : `<p class="troca-sub">Nome digitado no campo Docente: <b>${esc(nome)}</b></p>`}
            <div class="cad-campo cad-tipo">
                <label><input type="radio" name="cad-tipo" value="nome"${pelaLista || vaga ? '' : ' checked'}>
                    <span><b>Docente com nome</b>: já está no SIGAA, mas não na lista do Cardume.</span></label>
                <label><input type="radio" name="cad-tipo" value="vaga"${vaga ? ' checked' : ''}>
                    <span><b>Vaga (a definir)</b>: a pessoa ainda não foi definida (substituto a contratar, professor ainda não contatado).</span></label>
            </div>
            <div class="cad-corpo">
            ${vagasExistentes.length ? `
            <div class="cad-parecido cad-so-vaga">
                Vagas que já existem neste período. Se for a mesma pessoa, use a mesma vaga:
                ${vagasExistentes.map((p) => `<div class="cad-parecido-item"><b>${esc(p)}</b><button type="button" class="cad-usar" data-nome="${esc(p)}">Usar esta</button></div>`).join('')}
            </div>` : ''}
            ${parecidos.length ? `
            <div class="cad-parecido cad-so-nome">
                Já existe nome parecido. Se for a mesma pessoa, use o nome da lista:
                ${parecidos.map((p) => `<div class="cad-parecido-item"><b>${esc(p)}</b><button type="button" class="cad-usar" data-nome="${esc(p)}">Usar este</button></div>`).join('')}
            </div>` : ''}
            <div class="cad-campo">
                <span class="cad-rotulo"><span class="cad-so-vaga">Vínculo previsto</span><span class="cad-so-nome">Vínculo</span></span>
                <div class="cad-opcoes">
                    ${VINCULOS_DOCENTE_NOVO.map((v) => `<label><input type="radio" name="cad-vinculo" value="${v}"> ${v}</label>`).join('')}
                </div>
            </div>
            <div class="cad-linha">
                <label class="cad-campo"><span class="cad-rotulo">Unidade</span>
                    <select id="cad-unidade">
                        <option value="">Escolha…</option>
                        ${UNIDADES.map((u) => `<option value="${u.sigla}">${esc(u.nome)}</option>`).join('')}
                        <option value="${OUTRA_UNIDADE}">Outra unidade da UFPA</option>
                    </select>
                </label>
                <label class="cad-campo" id="cad-sub-lista"><span class="cad-rotulo">Subunidade (faculdade)</span>
                    <select id="cad-subunidade" disabled><option value="">Escolha a unidade</option></select>
                </label>
            </div>
            <div class="cad-linha hidden" id="cad-outra">
                <label class="cad-campo"><span class="cad-rotulo">Qual unidade</span>
                    <input type="text" id="cad-outra-unidade" maxlength="60" placeholder="Ex.: Campus de Ananindeua">
                </label>
                <label class="cad-campo"><span class="cad-rotulo">Qual subunidade</span>
                    <input type="text" id="cad-outra-subunidade" maxlength="60" placeholder="Ex.: Faculdade de Física">
                </label>
            </div>
            <label class="cad-campo cad-so-nome"><span class="cad-rotulo">Nome completo, igual ao SIGAA, <b>com os acentos</b>${pelaLista ? '' : ' (digite de novo)'}</span>
                <input type="text" id="cad-nome" autocomplete="off" spellcheck="false">
            </label>
            <div class="cad-parecido cad-so-nome hidden" id="cad-parecidos-vivos"></div>
            <div class="cad-vaga-nome cad-so-vaga">Nome da vaga no Cardume: <b id="cad-vaga-preview">escolha a subunidade</b></div>
            <div class="cad-erro" id="cad-erro"></div>
            <label class="cad-conferi cad-so-nome">
                <input type="checkbox" id="cad-conferi">
                <span>Conferi: o docente está cadastrado no SIGAA com este nome, completo, com os acentos e sem abreviações. Sem o SIGAA ele não consegue lançar os conceitos.</span>
            </label>
            <p class="troca-nota">
                O administrador do Cardume vai conferir este cadastro.<br>
                <span class="cad-so-vaga">Quando souber o nome da pessoa, troque a vaga pelo nome (Editar a componente).<br></span>
                <b>Pós-graduando, colaborador ou voluntário:</b> deixe a componente no nome do professor responsável.
            </p>
            </div>
            <div class="troca-acoes">
                <button type="button" class="btn-secondary troca-cancelar">Voltar e corrigir</button>
                <button type="button" class="cad-ok" disabled>Cadastrar</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onCadastroDocenteKeydown);

    const el = (sel) => overlay.querySelector(sel);
    // Poe o nome escolhido no campo: o clicado na lista, ou o que tinha o nome digitado.
    const colocarNome = (novo) => {
        if (!campo) {
            trocarNomeDocenteDigitado(nome, novo);
            return;
        }
        campo.value = novo;
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        campo.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const ehModoVaga = () => el('input[name="cad-tipo"]:checked')?.value === 'vaga';
    // Vagas ja usadas no periodo e as cadastradas agora (ainda nao salvas).
    const nomesParaNumerar = () => [...ligacoes.getKnownDocenteNames(), ...[...cadastrosDocentes.values()].map((c) => c.nome)];
    // Pela lista: o nome so e digitado na janela, entao os parecidos aparecem enquanto digita.
    const mostrarParecidos = (digitado) => {
        const caixa = el('#cad-parecidos-vivos');
        const conhecidos = ligacoes.getKnownDocenteNames();
        const exato = digitado ? acharNomeConhecido(digitado, conhecidos) : null;
        const lista = exato ? [exato] : (digitado ? findSimilarNames(digitado, conhecidos) : []);
        caixa.classList.toggle('hidden', !lista.length);
        caixa.innerHTML = lista.length
            ? `${exato ? 'Este nome já está na lista do Cardume:' : 'Já existe nome parecido. Se for a mesma pessoa, use o nome da lista:'}
               ${lista.map((p) => `<div class="cad-parecido-item"><b>${esc(p)}</b><button type="button" class="cad-usar" data-nome="${esc(p)}">Usar este</button></div>`).join('')}`
            : '';
        return exato;
    };
    const mostrarModo = () => {
        el('.cad-corpo').classList.toggle('hidden', !el('input[name="cad-tipo"]:checked'));
        const modoVaga = ehModoVaga();
        overlay.querySelectorAll('.cad-so-nome').forEach((n) => n.classList.toggle('hidden', modoVaga));
        overlay.querySelectorAll('.cad-so-vaga').forEach((n) => n.classList.toggle('hidden', !modoVaga));
        el('#cad-outra-subunidade').placeholder = modoVaga ? 'Sigla, ex.: FACFIS' : 'Ex.: Faculdade de Física';
        el('.cad-ok').textContent = modoVaga ? 'Cadastrar vaga' : 'Cadastrar';
    };
    const validar = () => {
        const modoVaga = ehModoVaga();
        const vinculo = el('input[name="cad-vinculo"]:checked')?.value || '';
        const outra = el('#cad-unidade').value === OUTRA_UNIDADE;
        const unidade = outra ? limparEspacos(el('#cad-outra-unidade').value) : el('#cad-unidade').value;
        const subunidade = outra ? limparEspacos(el('#cad-outra-subunidade').value) : el('#cad-subunidade').value;
        let erro = '';
        if (modoVaga) {
            if (subunidade && !siglaValida(subunidade)) erro = 'Na vaga, use a sigla da subunidade, sem espaços (ex.: FACFIS).';
            const vagaNome = subunidade && !erro ? proximaVaga(subunidade, nomesParaNumerar()) : '';
            el('#cad-vaga-preview').textContent = vagaNome || 'escolha a subunidade';
            el('#cad-erro').textContent = erro;
            const ok = !!(vinculo && unidade && vagaNome);
            el('.cad-ok').disabled = !ok;
            return ok ? { vaga: true, vinculo, redigitado: vagaNome, unidade, subunidade: subunidade.toUpperCase(), outra } : null;
        }
        const redigitado = limparEspacos(el('#cad-nome').value);
        const jaNaLista = pelaLista ? mostrarParecidos(redigitado) : null;
        if (redigitado) {
            erro = problemaNoNome(redigitado);
            if (!erro && ehVaga(redigitado)) erro = 'Para vaga, escolha "Vaga" no alto da janela.';
            if (!erro && jaNaLista) erro = 'Não precisa cadastrar: clique em "Usar este".';
            if (!erro && !pelaLista && normalizeTeacherNameForMatch(redigitado) !== normalizeTeacherNameForMatch(nome)) {
                erro = 'Não confere com o nome do campo Docente. Confira as letras dos dois.';
            }
        }
        el('#cad-erro').textContent = erro;
        const ok = !!(vinculo && unidade && subunidade && redigitado && !erro && el('#cad-conferi').checked);
        el('.cad-ok').disabled = !ok;
        return ok ? { vinculo, redigitado, unidade, subunidade, outra } : null;
    };

    el('#cad-unidade').addEventListener('change', () => {
        const unidade = UNIDADES.find((u) => u.sigla === el('#cad-unidade').value);
        const sub = el('#cad-subunidade');
        sub.innerHTML = unidade
            ? `<option value="">Escolha…</option>${unidade.subunidades.map((s) => `<option value="${s}">${s}</option>`).join('')}`
            : '<option value="">Escolha a unidade</option>';
        sub.disabled = !unidade;
        const outra = el('#cad-unidade').value === OUTRA_UNIDADE;
        el('#cad-sub-lista').classList.toggle('hidden', outra);
        el('#cad-outra').classList.toggle('hidden', !outra);
        if (outra) el('#cad-outra-unidade').focus();
    });
    overlay.querySelectorAll('input[name="cad-tipo"]').forEach((r) => r.addEventListener('change', mostrarModo));
    overlay.addEventListener('input', validar);
    overlay.addEventListener('change', validar);
    mostrarModo();

    // Clicar fora nao fecha: e um formulario, um clique perdido apagaria o que foi digitado.
    overlay.addEventListener('click', (e) => {
        if (e.target.closest('.troca-cancelar')) {
            fecharCadastroDocente();
            return;
        }
        const usar = e.target.closest('.cad-usar');
        if (usar) {
            colocarNome(usar.dataset.nome);
            fecharCadastroDocente();
            refreshAvisoDocenteNovo('mostrar');
            showToastWarning(`Nome trocado por "${usar.dataset.nome}", da lista do Cardume.`, 'success', 3200);
            return;
        }
        if (!e.target.closest('.cad-ok')) return;
        const dados = validar();
        if (!dados) return;
        cadastrosDocentes.set(normalizeTeacherNameForMatch(dados.redigitado), {
            nome: dados.redigitado,
            ...(dados.vaga ? { vaga: true } : {}),
            vinculo: dados.vinculo,
            unidade: dados.unidade,
            subunidade: dados.subunidade,
            ...(dados.outra ? { outraUnidade: true } : {}),
            por: getSessionEmail(),
            porNome: getPerfil()?.nome || '',
            em: new Date().toLocaleDateString('sv') // AAAA-MM-DD no fuso do computador
        });
        // Vaga: o nome gerado entra no campo. Nome: mesmas letras, mas com acento
        // ou maiuscula diferente, vale o redigitado.
        if (dados.redigitado !== limparEspacos(nome)) colocarNome(dados.redigitado);
        fecharCadastroDocente();
        refreshAvisoDocenteNovo('mostrar');
        showToastWarning(dados.vaga
            ? `Vaga cadastrada: ${dados.redigitado}. Agora é só salvar a componente.`
            : `${dados.redigitado} cadastrado. Agora é só salvar a componente.`, 'success', 3600);
    });

    setTimeout(() => el(pelaLista ? 'input[name="cad-tipo"]' : 'input[name="cad-vinculo"]')?.focus(), 50);
}

// Cadastros de docente novo que vao junto na alocacao: os feitos agora e os que
// ja estavam nas alocacoes substituidas (edicao), so dos nomes que continuam nela.
export function coletarCadastrosDocentes(nomes = [], idsAntigos = []) {
    const chaves = new Set(nomes.map(normalizeTeacherNameForMatch));
    const porChave = new Map();
    store.allocations
        .filter((a) => idsAntigos.includes(a.id))
        .forEach((a) => (Array.isArray(a.docentesCadastrados) ? a.docentesCadastrados : [])
            .forEach((c) => porChave.set(normalizeTeacherNameForMatch(c?.nome), c)));
    cadastrosDocentes.forEach((c, chave) => porChave.set(chave, c));
    return [...porChave.entries()]
        .filter(([chave]) => chaves.has(chave))
        .map(([, c]) => ({ ...c }));
}

export function setupAvisoDocenteNovo() {
    // Sugestoes de docente com ou sem acento nos tres campos (Docente, Multiplos
    // e a busca do Calendario Docente).
    ligarSugestoesDocente({
        seletor: '#inp-docente, .inp-multi-name, #sel-view-docente',
        getNomes: ligacoes.getKnownDocenteNames,
        // Primeira linha fixa nos campos de edicao: docente ainda sem nome.
        acaoFixa: {
            seletor: '#inp-docente, .inp-multi-name',
            rotulo: '+ Cadastrar docente fora da lista ou a definir…',
            aoEscolher: (campo) => abrirCadastroDocente('', { campo })
        }
    });
    ligacoes.inputConfig.docente?.addEventListener('input', () => refreshAvisoDocenteNovo('ocultar'));
    ligacoes.inputConfig.docente?.addEventListener('change', () => {
        ligacoes.ajustarNomeDigitado(ligacoes.inputConfig.docente);
        refreshAvisoDocenteNovo('mostrar');
    });
    const lista = document.getElementById('multi-docente-list');
    lista?.addEventListener('input', (e) => {
        if (e.target.matches('.inp-multi-name')) refreshAvisoDocenteNovo('ocultar');
    });
    lista?.addEventListener('change', (e) => {
        if (!e.target.matches('.inp-multi-name')) return;
        ligacoes.ajustarNomeDigitado(e.target);
        refreshAvisoDocenteNovo('mostrar');
    });
    document.getElementById('chk-multi-docente')?.addEventListener('change', () => refreshAvisoDocenteNovo('ocultar'));
}
