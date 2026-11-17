// ==UserScript==
// @name         Cardume -> SIGAA: preencher horario da turma
// @namespace    cardume.iecos.ufpa.br
// @version      1.4
// @description  Preenche as faixas de horario (datas + expressao) na tela "Horario da Turma" do SIGAA, a partir do texto do botao "Copiar faixas" do Cardume.
// @match        https://sigaa.ufpa.br/sigaa/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

// O QUE ESTE SCRIPT FAZ (e o que NAO faz)
// - Roda so no seu navegador, na pagina do SIGAA que voce ja abriu e logou.
// - Nao ve senha, nao guarda senha, nao envia nada para a internet
//   (nao ha nenhum fetch/XMLHttpRequest aqui: confira).
// - So aparece na tela "Horario da Turma" (formulario "formHorarios").
// - So clica em dois botoes: "Atualizar Grade de Horarios" e "Adicionar Horario".
//   Nunca clica em "Proximo Passo", "Passo Anterior" ou "Cancelar".
// - Se algo sair diferente do esperado, para e explica o motivo.
//
// Texto que ele entende (botao "Copiar faixas" do Cardume):
//   EP05073: 23T234 (04/01/2027 - 10/01/2027), 23T23456 (11/01/2027 - 02/02/2027)
// O codigo da componente no inicio ("EP05073:") e opcional; sem ele, voce confere
// a componente com os olhos na hora de confirmar.

(function () {
    'use strict';

    // ---------- Constantes ----------
    const CHAVE = 'cardumeSigaaFila';          // nome da "fila" guardada no sessionStorage
    const ESPERA_CLIQUE_MS = 800;              // pausa antes de cada clique (para voce ver)
    const VALIDADE_FILA_MS = 3 * 60 * 1000;    // fila parada ha mais de 3 min e descartada

    // ---------- Campos do SIGAA (conferidos no HTML real em 17/11/2026) ----------
    const form = document.getElementById('formHorarios');
    if (!form) {
        // Nao e a tela de horario. Se ficou uma fila de antes, ela e descartada.
        if (sessionStorage.getItem(CHAVE)) sessionStorage.removeItem(CHAVE);
        return;
    }
    const campoInicio = document.getElementById('formHorarios:dataInicioHorario');
    const campoFim = document.getElementById('formHorarios:dataFimHorario');
    const campoExpressao = document.getElementById('formHorarios:expressaoHorario');
    const botaoAtualizar = document.getElementById('formHorarios:defineTabelaHorario');
    // O "Adicionar Horario" nao tem id fixo: e achado pelo texto do botao.
    const botaoAdicionar = Array.from(form.querySelectorAll('input[type="submit"]'))
        .find((b) => /^Adicionar Hor/i.test(b.value || ''));

    // ---------- Fila (guardada no sessionStorage, sobrevive a recarga da pagina) ----------
    // A fila e guardada como TEXTO SIMPLES, sem JSON.stringify: o SIGAA usa a
    // biblioteca antiga "Prototype", que estraga o JSON.stringify de listas
    // (foi o que fez aparecer "undefined" nos campos no teste de 17/11/2026).
    // Formato: i|etapa|passos|ts|codigo|expr=ini=fim;expr=ini=fim
    function lerFila() {
        const linha = sessionStorage.getItem(CHAVE);
        if (!linha) return null;
        const p = linha.split('|');
        const faixas = (p[5] || '').split(';').map((s) => {
            const [expr, ini, fim] = s.split('=');
            return { expr, ini, fim };
        }).filter((f) => f.expr && f.ini && f.fim);
        if (p.length !== 6 || faixas.length === 0) {
            sessionStorage.removeItem(CHAVE); // fila estragada: descarta
            return null;
        }
        return { i: Number(p[0]), etapa: p[1], passos: Number(p[2]), ts: Number(p[3]), codigo: p[4], faixas };
    }
    function salvarFila(fila) {
        fila.ts = Date.now();
        const faixas = fila.faixas.map((f) => `${f.expr}=${f.ini}=${f.fim}`).join(';');
        sessionStorage.setItem(CHAVE, [fila.i, fila.etapa, fila.passos, fila.ts, fila.codigo, faixas].join('|'));
    }
    function limparFila() {
        sessionStorage.removeItem(CHAVE);
    }

    // ---------- Leitura do texto do Cardume ----------
    // Devolve { codigo, faixas: [{ expr, ini, fim }] } ou { erro }.
    function lerTextoCardume(texto) {
        const t = String(texto || '').replace(/\s+/g, ' ').trim();
        if (!t) return { erro: 'A area de transferencia esta vazia. Clique em "Copiar faixas" no Cardume.' };
        const mCodigo = t.match(/^([A-Z]{2,4}\d{3,6})\s*:/i);
        const codigo = mCodigo ? mCodigo[1].toUpperCase() : '';
        const faixas = [];
        const re = /((?:[2-7]+[MTN][1-6]+ ?)+)\((\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})\)/gi;
        let m;
        while ((m = re.exec(t)) !== null) {
            faixas.push({ expr: m[1].trim().toUpperCase(), ini: m[2], fim: m[3] });
        }
        if (faixas.length === 0) {
            return { erro: 'Nao reconheci o texto. Ele deve ser como:\n23T234 (04/01/2027 - 10/01/2027), 23T23456 (11/01/2027 - 02/02/2027)\n\nTexto recebido:\n' + t.slice(0, 200) };
        }
        // Confere datas: inicio <= fim, e uma faixa nao pode comecar antes do fim da anterior.
        const chave = (d) => d.split('/').reverse().join(''); // 04/01/2027 -> 20270104
        for (let i = 0; i < faixas.length; i++) {
            const f = faixas[i];
            if (chave(f.ini) > chave(f.fim)) return { erro: `Faixa ${i + 1}: a data inicial (${f.ini}) e depois da final (${f.fim}).` };
            if (i > 0 && chave(f.ini) <= chave(faixas[i - 1].fim)) {
                return { erro: `As faixas ${i} e ${i + 1} se sobrepoem (${faixas[i - 1].fim} e ${f.ini}). Confira no Cardume.` };
            }
        }
        return { codigo, faixas };
    }

    // Quantas caixinhas a expressao deve marcar. Ex.: "23T234" = 2 dias x 3 aulas = 6.
    function caixinhasEsperadas(expr) {
        let total = 0;
        expr.replace(/([2-7]+)[MTN]([1-6]+)/g, (_, dias, aulas) => { total += dias.length * aulas.length; return _; });
        return total;
    }

    // ---------- Leitura da pagina do SIGAA ----------
    // Texto de uma linha do cabecalho (ex.: "Componente:" -> "EP05073 - QUIMICA BASICA").
    function textoDoCabecalho(rotulo) {
        const th = Array.from(document.querySelectorAll('th')).find((el) => el.textContent.trim() === rotulo);
        const td = th && th.nextElementSibling;
        return td ? td.textContent.replace(/\s+/g, ' ').trim() : '';
    }
    function codigoDaPagina() {
        const m = textoDoCabecalho('Componente:').match(/^([A-Z]{2,4}\d{3,6})/i);
        return m ? m[1].toUpperCase() : '';
    }
    // Mensagem de erro do SIGAA na pagina (vazio = sem erro).
    // So conta mensagem VISIVEL: a que foi fechada em "(x) fechar mensagens" e ignorada.
    function erroDoSigaa() {
        const lugares = [
            document.getElementById('formHorarios:panelMsgErros'),
            ...document.querySelectorAll('#painel-erros, ul.erros')
        ];
        for (const el of lugares) {
            if (!el || el.getClientRects().length === 0) continue; // escondida
            const txt = el.textContent.replace(/\(x\) fechar mensagens/gi, '').replace(/\s+/g, ' ').trim();
            // O SIGAA usa o mesmo lugar para a mensagem de SUCESSO
            // ("Periodo Adicionado com Sucesso."): isso nao e erro.
            if (txt && !/sucesso/i.test(txt)) return txt;
        }
        return '';
    }
    // O que esta nos campos agora (para explicar quando algo da errado).
    function camposAgora() {
        const v = (c) => (c ? `"${c.value}"` : '(campo nao achado)');
        return `Nos campos agora: inicio=${v(campoInicio)}, fim=${v(campoFim)}, expressao=${v(campoExpressao)}`;
    }
    function caixinhasMarcadas() {
        return form.querySelectorAll('input[type="checkbox"][id^="formHorarios:h_"]:checked').length;
    }

    // Preenche um campo e avisa a pagina, como se fosse digitado.
    function preencher(campo, valor) {
        campo.value = valor;
        ['input', 'change', 'blur'].forEach((tipo) => campo.dispatchEvent(new Event(tipo, { bubbles: true })));
    }

    // ---------- Painel flutuante ----------
    const painel = document.createElement('div');
    painel.style.cssText = 'position:fixed; right:16px; bottom:16px; z-index:99999; background:#fff; border:2px solid #1e6b52; border-radius:8px; padding:10px 12px; box-shadow:0 4px 14px rgba(0,0,0,.25); font:13px Arial, sans-serif; max-width:340px; color:#222;';
    document.body.appendChild(painel);

    function estiloBotao(cor) {
        return `background:${cor}; color:#fff; border:0; border-radius:5px; padding:7px 12px; cursor:pointer; font-weight:bold; font-size:13px;`;
    }
    function mostrarInicial(mensagem) {
        painel.innerHTML = '';
        if (mensagem) {
            const p = document.createElement('div');
            p.style.cssText = 'margin-bottom:8px; white-space:pre-wrap;';
            p.textContent = mensagem;
            painel.appendChild(p);
        }
        const b = document.createElement('button');
        b.type = 'button'; // type=button: nunca envia o formulario do SIGAA
        b.textContent = 'Preencher pelo Cardume';
        b.style.cssText = estiloBotao('#1e6b52');
        b.onclick = iniciar;
        painel.appendChild(b);
    }
    function mostrarAndamento(texto) {
        painel.innerHTML = '';
        const p = document.createElement('div');
        p.style.cssText = 'margin-bottom:8px; white-space:pre-wrap;';
        p.textContent = texto;
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Cancelar preenchimento';
        b.style.cssText = estiloBotao('#c0392b');
        b.onclick = () => { limparFila(); mostrarInicial('Preenchimento cancelado. O que ja foi adicionado continua no SIGAA.'); };
        painel.append(p, b);
    }
    // Fim: so a mensagem e um botao OK, que fecha o painel (pedido de 17/11/2026:
    // o "Preencher pelo Cardume" no fim parecia que faltava fazer algo).
    // Ao abrir outra tela de horario, o botao verde volta.
    function mostrarConcluido(quantas, horario) {
        painel.innerHTML = '';
        painel.style.borderColor = '#27ae60';
        const p = document.createElement('div');
        p.style.cssText = 'margin-bottom:8px; white-space:pre-wrap;';
        p.textContent =
            `✔ CONCLUÍDO: ${quantas} faixa(s) adicionada(s).\n\n` +
            `Horário no SIGAA:\n${horario}\n\n` +
            'Confira se está igual ao "Copiar faixas" do Cardume.\n' +
            'Se estiver, clique em OK e siga no botão "Próximo Passo" do SIGAA.';
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'OK';
        b.style.cssText = estiloBotao('#27ae60') + ' min-width:80px;';
        b.onclick = () => { painel.remove(); };
        painel.append(p, b);
    }
    // Para tudo, limpa a fila e explica.
    function parar(motivo) {
        limparFila();
        mostrarInicial('PAREI: ' + motivo);
        painel.style.borderColor = '#c0392b';
    }

    // Clica no botao do SIGAA depois de uma pausa, se a fila nao foi cancelada.
    function clicarDepois(botao) {
        setTimeout(() => {
            if (!lerFila()) return; // cancelado nesse meio-tempo
            botao.click();          // o SIGAA recarrega a pagina; o script continua sozinho
        }, ESPERA_CLIQUE_MS);
    }

    // ---------- Inicio: clique no botao "Preencher pelo Cardume" ----------
    async function iniciar() {
        if (!campoInicio || !campoFim || !campoExpressao || !botaoAtualizar || !botaoAdicionar) {
            parar('Nao encontrei os campos da tela de horario. O SIGAA pode ter mudado.');
            return;
        }
        // 1) Le a area de transferencia (ou pede para colar, se o navegador nao deixar).
        let texto = '';
        try { texto = await navigator.clipboard.readText(); } catch (e) { texto = ''; }
        if (!/\(\d{2}\/\d{2}\/\d{4}/.test(texto)) {
            texto = window.prompt('Cole aqui o texto do "Copiar faixas" do Cardume:', '') || '';
            if (!texto) return;
        }
        const lido = lerTextoCardume(texto);
        if (lido.erro) { mostrarInicial(lido.erro); return; }

        // 2) Confere a componente.
        const componentePagina = textoDoCabecalho('Componente:');
        const codigoPagina = codigoDaPagina();
        let linhaComponente;
        if (lido.codigo) {
            if (lido.codigo !== codigoPagina) {
                mostrarInicial(`Componente diferente!\nCardume: ${lido.codigo}\nSIGAA: ${componentePagina || '(nao achei)'}\n\nNada foi feito.`);
                return;
            }
            linhaComponente = `Componente: ${componentePagina} (confere com o Cardume)`;
        } else {
            linhaComponente = `Componente nesta pagina: ${componentePagina}\n(o texto copiado nao tem o codigo: CONFIRA se e a componente certa)`;
        }

        // 3) Faixas que ja estao no SIGAA (mesmas datas na linha "Horario:") sao puladas.
        //    Assim, se o preenchimento parou no meio, e so clicar de novo.
        const horarioAtual = textoDoCabecalho('Horário:');
        const jaEstao = lido.faixas.filter((f) => horarioAtual.includes(`(${f.ini} - ${f.fim})`));
        const faltam = lido.faixas.filter((f) => !jaEstao.includes(f));
        if (faltam.length === 0) {
            mostrarInicial(`Todas as ${lido.faixas.length} faixa(s) ja estao no SIGAA:\n${horarioAtual}\n\nNada a fazer.`);
            return;
        }

        // 4) Resumo + aviso das frequencias + confirmacao.
        const lista = faltam.map((f, i) => `  ${i + 1}) ${f.expr}  de ${f.ini} a ${f.fim}`).join('\n');
        const ok = window.confirm(
            `${linhaComponente}\n\n` +
            `${faltam.length} faixa(s) serao adicionadas:\n${lista}\n\n` +
            (jaEstao.length ? `Ja estao no SIGAA e serao puladas: ${jaEstao.map((f) => `${f.expr} (${f.ini} - ${f.fim})`).join(', ')}\n\n` : '') +
            (horarioAtual && !jaEstao.length ? `ATENCAO: esta turma JA TEM horario: ${horarioAtual}\nAs faixas acima serao adicionadas a ele.\n\n` : '') +
            'AVISO DO SIGAA: editar datas ou horarios de uma turma APAGA as frequencias ja lancadas. Use em turmas sem frequencia.\n\n' +
            'Continuar?'
        );
        if (!ok) return;

        salvarFila({ codigo: codigoPagina, faixas: faltam, i: 0, etapa: 'preencher', passos: 0 });
        continuar();
    }

    // ---------- Andamento: roda a cada recarga da pagina ----------
    function continuar() {
        const fila = lerFila();
        if (!fila) { mostrarInicial(); return; }

        if (Date.now() - (fila.ts || 0) > VALIDADE_FILA_MS) { parar('A fila ficou parada por muito tempo e foi descartada. Comece de novo.'); return; }
        if (codigoDaPagina() !== fila.codigo) { parar('A componente da pagina mudou. Nada mais sera feito.'); return; }
        fila.passos = (fila.passos || 0) + 1;
        if (fila.passos > fila.faixas.length * 3 + 3) { parar('Passos demais (protecao contra repeticao).'); return; }
        // Erro do SIGAA so e conferido depois de um clique nosso (pagina recarregada);
        // mensagem antiga, de antes de comecar, nao atrapalha.
        if (fila.etapa !== 'preencher') {
            const erro = erroDoSigaa();
            if (erro) { parar(`o SIGAA mostrou um erro na faixa ${fila.i + 1}:\n${erro}\n\n${camposAgora()}`); return; }
        }

        const faixa = fila.faixas[fila.i];
        if (!faixa) { parar('a fila de faixas se perdeu. Comece de novo.'); return; }
        const n =`Faixa ${fila.i + 1} de ${fila.faixas.length}: ${faixa.expr} (${faixa.ini} - ${faixa.fim})`;

        if (fila.etapa === 'preencher') {
            // Preenche as datas e a expressao, e clica em "Atualizar Grade de Horarios".
            preencher(campoInicio, faixa.ini);
            preencher(campoFim, faixa.fim);
            preencher(campoExpressao, faixa.expr);
            if (campoInicio.value !== faixa.ini || campoFim.value !== faixa.fim || campoExpressao.value !== faixa.expr) {
                parar(`nao consegui escrever nos campos.\n${camposAgora()}`);
                return;
            }
            fila.etapa = 'conferirGrade';
            salvarFila(fila);
            mostrarAndamento(`${n}\nAtualizando a grade...`);
            clicarDepois(botaoAtualizar);
            return;
        }

        if (fila.etapa === 'conferirGrade') {
            // A pagina voltou do "Atualizar": confere as caixinhas e clica em "Adicionar Horario".
            const esperadas = caixinhasEsperadas(faixa.expr);
            const marcadas = caixinhasMarcadas();
            if (marcadas !== esperadas) {
                parar(`na faixa ${fila.i + 1} (${faixa.expr}) esperava ${esperadas} caixinhas marcadas e o SIGAA marcou ${marcadas}. Nada foi adicionado nesta faixa.\n\n${camposAgora()}`);
                return;
            }
            // Garante as datas (caso o SIGAA as tenha trocado na recarga).
            if (campoInicio.value !== faixa.ini) preencher(campoInicio, faixa.ini);
            if (campoFim.value !== faixa.fim) preencher(campoFim, faixa.fim);
            fila.etapa = 'conferirAdicao';
            salvarFila(fila);
            mostrarAndamento(`${n}\n${marcadas} caixinhas marcadas. Adicionando...`);
            clicarDepois(botaoAdicionar);
            return;
        }

        if (fila.etapa === 'conferirAdicao') {
            // A pagina voltou do "Adicionar": a faixa deve aparecer na linha "Horario:" do alto.
            const horario = textoDoCabecalho('Horário:');
            if (!horario.includes(`(${faixa.ini} - ${faixa.fim})`)) {
                parar(`nao encontrei a faixa ${fila.i + 1} (${faixa.ini} - ${faixa.fim}) na linha "Horário:" do alto da pagina. Confira o que foi adicionado.`);
                return;
            }
            fila.i += 1;
            if (fila.i >= fila.faixas.length) {
                limparFila();
                mostrarConcluido(fila.faixas.length, horario);
                return;
            }
            fila.etapa = 'preencher';
            salvarFila(fila);
            continuar(); // proxima faixa, na mesma pagina
            return;
        }

        parar('Etapa desconhecida na fila.');
    }

    continuar();
})();
