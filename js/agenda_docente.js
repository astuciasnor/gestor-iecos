// js/agenda_docente.js

import { store } from './store.js';
import { getCalendarEvents } from './calendar.js';

// Capturando os elementos do HTML da Visão Docente
const inpDocente = document.getElementById('inp-docente');
const listaSugestoes = document.getElementById('lista-sugestoes');
const containerMeses = document.getElementById('container-meses');
const grupoMes = document.getElementById('grupo-mes');
const divAgenda = document.getElementById('resultado-agenda');
const btnTopo = document.getElementById('btn-topo');
const wrapperTotalDocente = document.getElementById('wrapper-total-docente');
const lblTotalDocente = document.getElementById('lbl-total-docente');
const btnLimpar = document.getElementById('btn-limpar-docente');

let docenteSelecionadoAtual = '';
let mesSelecionadoAtual = '';
let docentesDisponiveis = [];

// 1. Quando a página carregar
document.addEventListener('DOMContentLoaded', async () => {
    // Carrega a estrutura base (Cursos e Turmas) do dados_app.json
    await store.loadData();

    try {
        const response = await fetch('alocacoes_publicas.json');

        if (response.ok) {
            const dadosPublicos = await response.json();

            // Verifica se é o formato novo (Objeto) ou o antigo (Array)
            if (Array.isArray(dadosPublicos)) {
                store.allocations = dadosPublicos;
            } else {
                store.allocations = dadosPublicos.allocations || [];
                // Lê dinamicamente as datas do semestre salvas pelo Coordenador
                if (dadosPublicos.settings) {
                    store.settings.termStart = dadosPublicos.settings.termStart;
                    store.settings.termEnd = dadosPublicos.settings.termEnd;
                }
            }
        } else {
            console.warn('Arquivo alocacoes_publicas.json não encontrado. Carregando modo Offline (Local).');
            store.loadAllocations();
        }
    } catch (error) {
        console.warn('Sem conexão ou rodando local. Carregando modo Offline (Local).');
        store.loadAllocations();
    }

    // Fallback de segurança 
    if (!store.settings.termStart) store.settings.termStart = '2026-02-01';
    if (!store.settings.termEnd) store.settings.termEnd = '2026-07-31';

    configurarEventos();
    preencherListaDocentes();
});

// 2. Extrai e preenche a lista de professores únicos do JSON
function preencherListaDocentes() {
    const docentesSet = new Set();

    // Varrer todas as alocações da base de dados e pegar Nomes
    // store.allocations é um array de eventos de aula (não há .eventos internamente)
    store.allocations.forEach(aloc => {
        if (aloc.docente) {
            if (typeof aloc.docente === 'string') {
                docentesSet.add(aloc.docente.trim());
            } else if (aloc.docente.nome) {
                docentesSet.add(aloc.docente.nome.trim());
            }
        }

        if (aloc.docentes && Array.isArray(aloc.docentes)) {
            aloc.docentes.forEach(d => {
                const nome = d.nome || d;
                if (typeof nome === 'string') {
                    docentesSet.add(nome.trim());
                }
            });
        }
    });

    // Remove vazios e undefined e ordena
    docentesDisponiveis = Array.from(docentesSet).filter(d => d && d.toUpperCase() !== 'A DEFINIR').sort();

    if (docentesDisponiveis.length === 0) {
        inpDocente.placeholder = "Nenhum professor alocado.";
        inpDocente.disabled = true;
    } else {
        inpDocente.placeholder = "Busque o professor...";
        inpDocente.disabled = false;
    }
}

// ===== NOVO MOTOR DE AUTOCOMPLETE =====
function renderizarSugestoes(termo) {
    if (!listaSugestoes) return;
    listaSugestoes.innerHTML = ''; // Limpa a lista atual

    if (!termo) {
        listaSugestoes.style.display = 'none';
        return;
    }

    const termoUpper = termo.toUpperCase();
    const filtrados = docentesDisponiveis.filter(d => d.toUpperCase().includes(termoUpper));

    if (filtrados.length === 0) {
        listaSugestoes.style.display = 'none';
        return;
    }

    // Cria os itens visuais (li) para os resultados
    filtrados.forEach(docente => {
        const li = document.createElement('li');
        li.textContent = docente;
        li.className = 'sugestao-item';
        li.addEventListener('mousedown', (e) => {
            // Usa mousedown para evitar que o onblur do input esconda a lista antes do click
            e.preventDefault();
            selecionarProfessor(docente);
        });
        listaSugestoes.appendChild(li);
    });

    listaSugestoes.style.display = 'block';
}

function selecionarProfessor(nomeProfessor) {
    inpDocente.value = nomeProfessor;
    if (listaSugestoes) listaSugestoes.style.display = 'none';

    docenteSelecionadoAtual = nomeProfessor;
    mesSelecionadoAtual = '';
    divAgenda.innerHTML = '';
    wrapperTotalDocente.style.display = 'none';
    grupoMes.style.display = 'block';
    preencherMeses();

    // Recolhe o teclado do celular
    inpDocente.blur();

    // Mostra o botão X para limpar
    if (btnLimpar) btnLimpar.style.display = 'flex';
}

function configurarEventos() {
    // Escutamos o que o usuário digita para filtrar a lista
    inpDocente.addEventListener('input', (e) => {
        const valorDigitado = e.target.value.trim();

        // Se ele apagar ou trocar o nome selecionado, zera o modo "Professor Selecionado"
        if (docenteSelecionadoAtual && valorDigitado !== docenteSelecionadoAtual) {
            docenteSelecionadoAtual = '';
            grupoMes.style.display = 'none';
            containerMeses.innerHTML = '<span class="msg-vazio">Aguardando professor...</span>';
            divAgenda.innerHTML = '';
            wrapperTotalDocente.style.display = 'none';
            if (btnLimpar) btnLimpar.style.display = 'none';
        }

        // Mostra/esconde o X conforme haja texto
        if (btnLimpar) btnLimpar.style.display = valorDigitado ? 'flex' : 'none';

        renderizarSugestoes(valorDigitado);
    });

    // Esconde a lista de sugestões se o usuário clicar fora do input
    inpDocente.addEventListener('blur', () => {
        // Um pequeno delay para dar tempo do mousedown da lista engatilhar
        setTimeout(() => {
            if (listaSugestoes) listaSugestoes.style.display = 'none';
        }, 150);
    });

    // Se clicar no input de novo, mostra a lista cheia ou filtrada
    inpDocente.addEventListener('focus', () => {
        renderizarSugestoes(inpDocente.value.trim());
    });

    // Botão X para limpar a seleção do professor
    if (btnLimpar) {
        btnLimpar.addEventListener('click', () => {
            inpDocente.value = '';
            docenteSelecionadoAtual = '';
            mesSelecionadoAtual = '';
            grupoMes.style.display = 'none';
            containerMeses.innerHTML = '<span class="msg-vazio">Aguardando professor...</span>';
            divAgenda.innerHTML = '';
            wrapperTotalDocente.style.display = 'none';
            btnLimpar.style.display = 'none';
            if (listaSugestoes) listaSugestoes.style.display = 'none';
            inpDocente.focus();
        });
    }

    // Lógica do botão Voltar ao Topo
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            btnTopo.style.display = 'flex';
        } else {
            btnTopo.style.display = 'none';
        }
    });

    btnTopo.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

function preencherMeses() {
    containerMeses.innerHTML = '';

    if (!docenteSelecionadoAtual) return;

    const inicio = store.settings.termStart;
    const fim = store.settings.termEnd;

    if (inicio && fim) {
        let dataAtual = new Date(inicio + 'T12:00:00');
        const dataFim = new Date(fim + 'T12:00:00');
        const mesesAdicionados = new Set();
        let encontrouMeses = false;

        while (dataAtual <= dataFim) {
            const ano = dataAtual.getFullYear();
            const mes = String(dataAtual.getMonth() + 1).padStart(2, '0');
            const mesAno = `${ano}-${mes}`;

            if (!mesesAdicionados.has(mesAno)) {
                mesesAdicionados.add(mesAno);
                encontrouMeses = true;

                const nomeMes = dataAtual.toLocaleString('pt-BR', { month: 'long' });

                const btn = document.createElement('button');
                btn.className = 'btn-seletor';
                btn.textContent = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);

                btn.addEventListener('click', () => {
                    Array.from(containerMeses.children).forEach(filho => filho.classList.remove('active'));
                    btn.classList.add('active');

                    mesSelecionadoAtual = mesAno;
                    renderizarAgenda();
                });

                containerMeses.appendChild(btn);
            }
            dataAtual.setMonth(dataAtual.getMonth() + 1);
        }

        if (!encontrouMeses) {
            containerMeses.innerHTML = '<span class="msg-vazio">Nenhum mês letivo configurado</span>';
        }
    } else {
        containerMeses.innerHTML = '<span class="msg-vazio">Semestre não configurado no painel</span>';
    }
}

function renderizarAgenda() {
    if (!docenteSelecionadoAtual || !mesSelecionadoAtual) return;

    divAgenda.innerHTML = `
        <div class="loading-msg">
            ⏳ A desenhar a grade semanal...
        </div>
    `;

    // Oculta o contador de horas temporariamente enquanto carrega
    wrapperTotalDocente.style.display = 'none';

    setTimeout(() => {
        const [ano, mes] = mesSelecionadoAtual.split('-');
        const dataInicio = `${ano}-${mes}-01`;
        const ultimoDia = new Date(ano, mes, 0).getDate();
        const dataFim = `${ano}-${mes}-${ultimoDia}`;

        // MÁGICA DOCENTE: Passamos \`null\` no turmaId e Injetamos \`docenteSelecionadoAtual\` no filtro extra do getCalendarEvents
        const calendarData = getCalendarEvents(null, dataInicio, dataFim, docenteSelecionadoAtual);

        gerarGradeSemanalHTML(calendarData, ano, mes);
        calcularExibirTotalHoras(calendarData);
    }, 500);
}

function calcularExibirTotalHoras(calendarData) {
    let totalCargaMensal = 0;

    // Varre o calendario montado somando as cargas horárias
    Object.values(calendarData).forEach(eventosDia => {
        eventosDia.forEach(ev => {
            if (ev.type !== 'holiday') {
                // Acha a duração em minutos e converte para Horas-Aula (blocos de 50 min)
                let qtdHorasAula = 2; // default
                if (ev.horario && ev.horario.includes(' - ')) {
                    const [hIni, hFim] = ev.horario.split(' - ');
                    const [hi, mi] = hIni.split(':').map(Number);
                    const [hf, mf] = hFim.split(':').map(Number);

                    const minutosTotais = (hf * 60 + mf) - (hi * 60 + mi);
                    qtdHorasAula = Math.round(minutosTotais / 50);
                }
                totalCargaMensal += qtdHorasAula;
            }
        });
    });

    lblTotalDocente.textContent = `Aulas neste mês: ${totalCargaMensal} horas-aula`;
    wrapperTotalDocente.style.display = 'block';
}

function gerarGradeSemanalHTML(calendarData, ano, mes) {
    let html = '';

    const primeiroDiaMes = new Date(ano, mes - 1, 1, 12, 0, 0);
    const ultimoDiaMes = new Date(ano, mes, 0, 12, 0, 0);

    let dataAtual = new Date(primeiroDiaMes);
    let diaSemana = dataAtual.getDay();
    let diff = diaSemana === 0 ? -6 : 1 - diaSemana;
    dataAtual.setDate(dataAtual.getDate() + diff);

    const diasNomes = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    let temAulaNoMes = false;

    const inicioSemestre = new Date(store.settings.termStart + 'T12:00:00');
    const fimSemestre = new Date(store.settings.termEnd + 'T12:00:00');

    while (dataAtual <= ultimoDiaMes || dataAtual.getDay() !== 1) {
        if (dataAtual > ultimoDiaMes && dataAtual.getDay() === 1) break;

        if (dataAtual.getDay() === 1) {
            const dataFimSemana = new Date(dataAtual);
            dataFimSemana.setDate(dataFimSemana.getDate() + 5);

            if (dataFimSemana < inicioSemestre) {
                dataAtual.setDate(dataAtual.getDate() + 7);
                continue;
            }

            if (dataAtual > fimSemestre) {
                break;
            }

            const strInicio = `${String(dataAtual.getDate()).padStart(2, '0')}/${String(dataAtual.getMonth() + 1).padStart(2, '0')}`;
            const strFim = `${String(dataFimSemana.getDate()).padStart(2, '0')}/${String(dataFimSemana.getMonth() + 1).padStart(2, '0')}`;

            html += `
            <div class="semana-block">
                <div class="semana-header">Semana de ${strInicio} a ${strFim}</div>
                <div class="grade-semana">
            `;
        }

        if (dataAtual.getDay() >= 1 && dataAtual.getDay() <= 6) {
            const dateStr = dataAtual.toISOString().split('T')[0];
            const diaFormatado = String(dataAtual.getDate()).padStart(2, '0');
            const idxSemana = dataAtual.getDay() - 1;

            html += `
                <div class="grade-dia">
                    <div class="grade-dia-header">
                        <div class="nome-dia">${diasNomes[idxSemana]}</div>
                        <div class="num-dia">${diaFormatado}</div>
                    </div>
                    <div class="grade-slots">
            `;

            const eventosAtivos = calendarData[dateStr] || [];

            if (eventosAtivos.length > 0) temAulaNoMes = true;

            const feriado = eventosAtivos.find(e => e.type === 'holiday');

            if (feriado) {
                html += `<div class="feriado-chip" title="${feriado.title}">Feriado</div>`;
            } else {
                eventosAtivos.forEach(ev => {
                    const horario = ev.horario || (ev.horariosOcupados ? ev.horariosOcupados[0] : '--:--');
                    const titulo = ev.title || ev.disciplina;
                    const cor = ev.cor || '#2c3e50';
                    const tipo = ev.tipo || 'regular';

                    // Como não filtramos por 'TurmaId', precisamos extrair isso de algum lugar p/ mostrar pro professor
                    const turmaDestino = ev.turmaId || "TURMA N/D";
                    const turmaBasica = turmaDestino.split('_')[0] || turmaDestino;

                    let tituloLimpo = titulo.replace(/^\([a-zA-Z]\)\s*/, '').trim();
                    const sigla = tituloLimpo.substring(0, 4).toUpperCase();

                    // MÁGICA DOCENTE: Exibe a turma no Chip para o professor saber onde dar aula
                    const siglaComTurma = `${sigla} • ${turmaBasica}`;

                    const horaCurta = horario.split(':')[0] + 'h';
                    const dataExibicao = `${diaFormatado}/${String(dataAtual.getMonth() + 1).padStart(2, '0')}/${dataAtual.getFullYear()}`;

                    html += `
                        <div class="mini-chip" style="background-color: ${cor}"
                             data-titulo="${titulo.replace(/"/g, '&quot;')}"
                             data-turma="${turmaDestino.replace(/"/g, '&quot;')}"
                             data-horario="${horario}"
                             data-data="${dataExibicao}"
                             data-tipo="${tipo}"
                             data-cor="${cor}">
                            <div class="chip-hora">${horaCurta}</div>
                            <div class="chip-sigla">${siglaComTurma}</div>
                        </div>
                    `;
                });
            }

            html += `</div></div>`;
        }

        if (dataAtual.getDay() === 6) {
            html += `</div></div>`;
        }
        dataAtual.setDate(dataAtual.getDate() + 1);
    }

    if (!temAulaNoMes) {
        html = '<div class="sem-aulas">🏖️ Você não possui aulas neste período.</div>';
    }

    divAgenda.innerHTML = html;
    ativarInteracaoChips();
}

function ativarInteracaoChips() {
    const chips = document.querySelectorAll('.mini-chip');
    const overlay = document.getElementById('sheet-overlay');
    const sheet = document.getElementById('bottom-sheet');
    const btnFechar = document.getElementById('btn-fechar-sheet');

    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const titulo = chip.getAttribute('data-titulo');
            const turmaDestino = chip.getAttribute('data-turma');
            const horario = chip.getAttribute('data-horario');
            const data = chip.getAttribute('data-data');
            const tipo = chip.getAttribute('data-tipo');
            const cor = chip.getAttribute('data-cor');

            const elTitle = document.getElementById('sheet-title');
            elTitle.textContent = titulo;
            elTitle.style.color = cor;

            document.getElementById('sheet-turma').textContent = turmaDestino;
            document.getElementById('sheet-horario').textContent = horario;
            document.getElementById('sheet-data').textContent = data;

            let tipoTexto = 'Aula Regular';
            if (tipo === 'intensiva') tipoTexto = 'Aula Intensiva (Blocada)';
            if (tipo === 'regular_prioritaria') tipoTexto = 'Regular Prioritária';
            document.getElementById('sheet-tipo').textContent = tipoTexto;

            overlay.classList.add('active');
            sheet.classList.add('active');
        });
    });

    const fecharModal = () => {
        overlay.classList.remove('active');
        sheet.classList.remove('active');
    };

    if (btnFechar) btnFechar.addEventListener('click', fecharModal);
    if (overlay) overlay.addEventListener('click', fecharModal);
}
