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

    // Fallback de segurança (caso o coordenador tenha esquecido de definir datas no painel)
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

    // Mensagem de carregamento animada
    divAgenda.innerHTML = `
        <div class="loading-msg">
            ⏳ A preparar a agenda da turma...
        </div>
    `;

    // Atraso de 500ms para a animação
    setTimeout(() => {
        const [ano, mes] = mesSelecionado.split('-');
        const dataInicio = `${ano}-${mes}-01`;
        const ultimoDia = new Date(ano, mes, 0).getDate();
        const dataFim = `${ano}-${mes}-${ultimoDia}`;

        const calendarData = getCalendarEvents(turmaId, dataInicio, dataFim);
        gerarCartoesHTML(calendarData);
    }, 500); 
}

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