// js/consulta.js

import { store } from './store.js';
import { getCalendarEvents } from './calendar.js';

// Capturando os elementos do HTML
const selCurso = document.getElementById('public-sel-curso');
const selTurma = document.getElementById('public-sel-turma');
const selMes = document.getElementById('public-sel-mes');
const divAgenda = document.getElementById('resultado-agenda');
const btnTopo = document.getElementById('btn-topo'); 

// 1. Quando a página carregar, executamos isso:
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
            console.log("Dados carregados do arquivo público (Online)");
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
    preencherCursos();
});

// 2. O que acontece quando o usuário interage com os selects
function configurarEventos() {
    selCurso.addEventListener('change', () => {
        preencherTurmas(selCurso.value);
        selMes.innerHTML = '<option value="">Aguardando turma...</option>';
        selMes.disabled = true;
        divAgenda.innerHTML = ''; 
    });

    selTurma.addEventListener('change', () => {
        preencherMeses();
        divAgenda.innerHTML = ''; 
    });
    
    selMes.addEventListener('change', () => {
        renderizarAgenda();
    });

    // Lógica do botão Voltar ao Topo
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            btnTopo.style.display = 'flex'; 
        } else {
            btnTopo.style.display = 'none'; 
        }
    });

    // Ação de clique no botão
    btnTopo.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth' 
        });
    });
}

// 3. Preenchendo as caixas de seleção
function preencherCursos() {
    selCurso.innerHTML = '<option value="">Selecione um curso...</option>';
    if (store.rawData && store.rawData.cursos) {
        store.rawData.cursos.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.sigla;
            opt.textContent = c.curso;
            selCurso.appendChild(opt);
        });
    }
}

function preencherTurmas(cursoSigla) {
    selTurma.innerHTML = '<option value="">Selecione a turma...</option>';
    if (!cursoSigla || !store.rawData.turmas) {
        selTurma.disabled = true;
        return;
    }

    const turmasDoCurso = store.rawData.turmas.filter(t => t.sigla === cursoSigla);
    
    if (turmasDoCurso.length > 0) {
        turmasDoCurso.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.turma_id;
            opt.textContent = t.turma_label;
            selTurma.appendChild(opt);
        });
        selTurma.disabled = false;
    } else {
        selTurma.innerHTML = '<option value="">Nenhuma turma encontrada</option>';
        selTurma.disabled = true;
    }
}

function preencherMeses() {
    selMes.innerHTML = '<option value="">Selecione o mês...</option>';
    const turmaId = selTurma.value;
    
    if (!turmaId) {
        selMes.disabled = true;
        return;
    }

    const inicio = store.settings.termStart;
    const fim = store.settings.termEnd;

    if (inicio && fim) {
        let dataAtual = new Date(inicio + 'T12:00:00'); 
        const dataFim = new Date(fim + 'T12:00:00');
        const mesesAdicionados = new Set();

        while (dataAtual <= dataFim) {
            const ano = dataAtual.getFullYear();
            const mes = String(dataAtual.getMonth() + 1).padStart(2, '0');
            const mesAno = `${ano}-${mes}`; 
            
            if (!mesesAdicionados.has(mesAno)) {
                mesesAdicionados.add(mesAno);
                const nomeMes = dataAtual.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
                
                const opt = document.createElement('option');
                opt.value = mesAno;
                opt.textContent = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);
                selMes.appendChild(opt);
            }
            dataAtual.setMonth(dataAtual.getMonth() + 1);
        }
        selMes.disabled = false;
    } else {
        selMes.innerHTML = '<option value="">Semestre não configurado no painel admin</option>';
    }
}

// 4. Renderizando os Cartões da Agenda
function renderizarAgenda() {
    const turmaId = selTurma.value;
    const mesSelecionado = selMes.value;
    
    if (!turmaId || !mesSelecionado) return;

    divAgenda.innerHTML = `
        <div class="loading-msg">
            ⏳ A desenhar a grade semanal...
        </div>
    `;

    setTimeout(() => {
        const [ano, mes] = mesSelecionado.split('-');
        const dataInicio = `${ano}-${mes}-01`;
        const ultimoDia = new Date(ano, mes, 0).getDate();
        const dataFim = `${ano}-${mes}-${ultimoDia}`;

        const calendarData = getCalendarEvents(turmaId, dataInicio, dataFim);
        
        gerarGradeSemanalHTML(calendarData, ano, mes);
    }, 500); 
}

// MANTIDO: O código original antigo intacto como backup/legado
function gerarCartoesHTML(calendarData) {
    let html = '';
    const diasDaSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const datas = Object.keys(calendarData).sort();
    let temAulaNoMes = false;

    datas.forEach(dataStr => {
        const eventos = calendarData[dataStr];
        
        if (!eventos || eventos.length === 0) return;
        
        const eventosAtivos = eventos.filter(e => e.type !== 'suspended');
        if (eventosAtivos.length === 0) return;

        temAulaNoMes = true;

        const [ano, mes, dia] = dataStr.split('-');
        const dataObj = new Date(dataStr + 'T12:00:00');
        const nomeDiaSemana = diasDaSemana[dataObj.getDay()];
        const dataFormatada = `${dia}/${mes}`;

        html += `
        <div class="dia-card">
            <div class="dia-header">
                <span class="dia-numero">${dataFormatada}</span>
                <span class="dia-semana">${nomeDiaSemana}</span>
            </div>
            <div class="dia-body">
        `;

        const feriado = eventosAtivos.find(e => e.type === 'holiday');
        if (feriado) {
            html += `<div class="evento-feriado">🎉 Feriado: ${feriado.title}</div>`;
        } else {
            eventosAtivos.forEach(ev => {
                const horario = ev.horario || (ev.horariosOcupados ? ev.horariosOcupados[0] : '--:--');
                const titulo = ev.title || ev.disciplina;
                const docente = ev.docente || 'A definir';
                const cor = ev.cor || '#bdc3c7';

                let labelTipo = '';
                if (ev.tipo === 'intensiva') labelTipo = '<span class="badge intensiva">Intensiva</span>';
                if (ev.tipo === 'regular_prioritaria') labelTipo = '<span class="badge prioritaria">Prioritária</span>';

                html += `
                <div class="aula-item" style="border-left: 5px solid ${cor}">
                    <div class="aula-horario">${horario}</div>
                    <div class="aula-info">
                        <div class="aula-titulo">${titulo} ${labelTipo}</div>
                        <div class="aula-docente">👨‍🏫 ${docente}</div>
                    </div>
                </div>
                `;
            });
        }

        html += `</div></div>`;
    });

    if (!temAulaNoMes) {
        html = '<div class="sem-aulas">⛱️ Nenhuma aula ou evento programado para esta turma neste mês.</div>';
    }

    divAgenda.innerHTML = html;
}

// =========================================================================
// ==================== NOVAS FUNÇÕES DA OPÇÃO C ===========================
// =========================================================================

// 5. NOVA VISÃO: Grade Semanal (Seg a Sáb) com Travas de Data
function gerarGradeSemanalHTML(calendarData, ano, mes) {
    let html = '';
    
    const primeiroDiaMes = new Date(ano, mes - 1, 1, 12, 0, 0);
    const ultimoDiaMes = new Date(ano, mes, 0, 12, 0, 0);
    
    let dataAtual = new Date(primeiroDiaMes);
    
    let diaSemana = dataAtual.getDay(); // 0=Dom, 1=Seg, 6=Sáb
    let diff = diaSemana === 0 ? -6 : 1 - diaSemana; 
    dataAtual.setDate(dataAtual.getDate() + diff); 
    
    const diasNomes = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    let temAulaNoMes = false;

    // Converte os limites do semestre para comparar
    const inicioSemestre = new Date(store.settings.termStart + 'T12:00:00');
    const fimSemestre = new Date(store.settings.termEnd + 'T12:00:00');

    // Loop pelas semanas até o mês acabar
    while (dataAtual <= ultimoDiaMes || dataAtual.getDay() !== 1) { 
        if (dataAtual > ultimoDiaMes && dataAtual.getDay() === 1) break;

        // SEGUNDA-FEIRA: Abre o bloco da semana
        if (dataAtual.getDay() === 1) {
            const sabadoDaSemana = new Date(dataAtual);
            sabadoDaSemana.setDate(sabadoDaSemana.getDate() + 5); 
            
            // CORREÇÃO 1: Se o Sábado desta semana for antes do início do semestre, PULA!
            if (sabadoDaSemana < inicioSemestre) {
                dataAtual.setDate(dataAtual.getDate() + 7);
                continue; 
            }
            
            // CORREÇÃO 1: Se a Segunda desta semana já for depois do fim do semestre, PARA!
            if (dataAtual > fimSemestre) {
                break; 
            }

            const strInicio = `${String(dataAtual.getDate()).padStart(2,'0')}/${String(dataAtual.getMonth()+1).padStart(2,'0')}`;
            const strFim = `${String(sabadoDaSemana.getDate()).padStart(2,'0')}/${String(sabadoDaSemana.getMonth()+1).padStart(2,'0')}`;
            
            html += `
            <div class="semana-block">
                <div class="semana-header">Semana de ${strInicio} a ${strFim}</div>
                <div class="grade-semana">
            `;
        }

        // De Segunda (1) a Sábado (6): Desenha a coluna do dia
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

            const eventos = calendarData[dateStr] || [];
            const eventosAtivos = eventos.filter(e => e.type !== 'suspended');
            
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

                    // CORREÇÃO 2: Mostrar todos os professores envolvidos
                    let docente = ev.docente || 'A definir';
                    if (ev.docentes && Array.isArray(ev.docentes) && ev.docentes.length > 0) {
                        docente = ev.docentes.map(d => d.nome || d).join(' / ');
                    }

                    const sigla = titulo.substring(0, 3).toUpperCase();
                    const horaCurta = horario.split(':')[0] + 'h'; 
                    const dataExibicao = `${diaFormatado}/${String(dataAtual.getMonth()+1).padStart(2,'0')}/${dataAtual.getFullYear()}`;

                    html += `
                        <div class="mini-chip" style="background-color: ${cor}"
                             data-titulo="${titulo.replace(/"/g, '&quot;')}"
                             data-docente="${docente.replace(/"/g, '&quot;')}"
                             data-horario="${horario}"
                             data-data="${dataExibicao}"
                             data-tipo="${tipo}"
                             data-cor="${cor}">
                            <div class="chip-hora">${horaCurta}</div>
                            <div class="chip-sigla">${sigla}</div>
                        </div>
                    `;
                });
            }

            html += `</div></div>`; 
        }

        // SÁBADO: Fecha o bloco da semana
        if (dataAtual.getDay() === 6) {
            html += `</div></div>`; 
        }

        // Avança um dia
        dataAtual.setDate(dataAtual.getDate() + 1); 
    }

    if (!temAulaNoMes) {
        html = '<div class="sem-aulas">⛱️ Nenhuma aula ou evento programado para esta turma nesta parte do semestre.</div>';
    }

    divAgenda.innerHTML = html;
    ativarInteracaoChips(); 
}

// 6. Controla a janela que sobe ao clicar nos quadradinhos (Bottom Sheet)
function ativarInteracaoChips() {
    const chips = document.querySelectorAll('.mini-chip');
    const overlay = document.getElementById('sheet-overlay');
    const sheet = document.getElementById('bottom-sheet');
    const btnFechar = document.getElementById('btn-fechar-sheet');

    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const titulo = chip.getAttribute('data-titulo');
            const docente = chip.getAttribute('data-docente');
            const horario = chip.getAttribute('data-horario');
            const data = chip.getAttribute('data-data');
            const tipo = chip.getAttribute('data-tipo');
            const cor = chip.getAttribute('data-cor');

            const elTitle = document.getElementById('sheet-title');
            elTitle.textContent = titulo;
            elTitle.style.color = cor;
            
            document.getElementById('sheet-docente').textContent = docente;
            document.getElementById('sheet-horario').textContent = horario;
            document.getElementById('sheet-data').textContent = data;

            let tipoTexto = 'Aula Regular';
            if(tipo === 'intensiva') tipoTexto = 'Aula Intensiva (Blocada)';
            if(tipo === 'regular_prioritaria') tipoTexto = 'Regular Prioritária';
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