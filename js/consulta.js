// js/consulta.js

import { store } from './store.js';
import { getCalendarEvents } from './calendar.js';

// Capturando os elementos do HTML
const selCurso = document.getElementById('public-sel-curso');
const selTurma = document.getElementById('public-sel-turma');
const selMes = document.getElementById('public-sel-mes');
const divAgenda = document.getElementById('resultado-agenda');

// 1. Quando a página carregar, executamos isso:
document.addEventListener('DOMContentLoaded', async () => {
    // O store oficial já sabe carregar o dados_app.json e o localStorage do admin
    await store.loadData();
    configurarEventos();
    preencherCursos();
});

// 2. O que acontece quando o usuário interage com os selects
function configurarEventos() {
    // Quando escolhe o curso -> Libera as turmas
    selCurso.addEventListener('change', () => {
        preencherTurmas(selCurso.value);
        selMes.innerHTML = '<option value="">Aguardando turma...</option>';
        selMes.disabled = true;
        divAgenda.innerHTML = ''; // Limpa a agenda se trocar o curso
    });

    // Quando escolhe a turma -> Libera os meses
    selTurma.addEventListener('change', () => {
        preencherMeses();
        divAgenda.innerHTML = ''; // Limpa a agenda se trocar a turma
    });
    
    // Quando escolhe o mês -> Desenha os cartões
    selMes.addEventListener('change', () => {
        renderizarAgenda();
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

    // Calcula os meses com base nas datas configuradas no store (painel admin)
    const inicio = store.settings.termStart;
    const fim = store.settings.termEnd;

    if (inicio && fim) {
        let dataAtual = new Date(inicio + 'T12:00:00'); // T12 previne bugs de fuso horário
        const dataFim = new Date(fim + 'T12:00:00');
        const mesesAdicionados = new Set();

        while (dataAtual <= dataFim) {
            const ano = dataAtual.getFullYear();
            const mes = String(dataAtual.getMonth() + 1).padStart(2, '0');
            const mesAno = `${ano}-${mes}`; // Fica no formato "2026-02"
            
            if (!mesesAdicionados.has(mesAno)) {
                mesesAdicionados.add(mesAno);
                // Gera o nome bonito em português (ex: "fevereiro de 2026")
                const nomeMes = dataAtual.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
                
                const opt = document.createElement('option');
                opt.value = mesAno;
                // Deixa a primeira letra maiúscula
                opt.textContent = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);
                selMes.appendChild(opt);
            }
            // Pula para o próximo mês
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

    divAgenda.innerHTML = '<p style="text-align:center; color:#7f8c8d; font-weight:bold; margin-top:20px;">Gerando agenda...</p>';

    // Calculamos o primeiro e o último dia do mês escolhido
    const [ano, mes] = mesSelecionado.split('-');
    const dataInicio = `${ano}-${mes}-01`;
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const dataFim = `${ano}-${mes}-${ultimoDia}`;

    // A MÁGICA ACONTECE AQUI: Chama o motor do calendário original!
    const calendarData = getCalendarEvents(turmaId, dataInicio, dataFim);
    
    gerarCartoesHTML(calendarData);
}

function gerarCartoesHTML(calendarData) {
    let html = '';
    const diasDaSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const datas = Object.keys(calendarData).sort();
    let temAulaNoMes = false;

    datas.forEach(dataStr => {
        const eventos = calendarData[dataStr];
        
        // Se o dia não tem nenhum evento programado, pulamos (limpa a tela do aluno)
        if (!eventos || eventos.length === 0) return;
        
        // Verifica se há aulas ativas ou feriados (ignora dias que só têm aulas suspensas)
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