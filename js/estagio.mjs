// Regras proprias das componentes de ESTAGIO (funcoes puras, sem tela).
//
// Choque no estagio (decidido com a coordenacao em 18/11/2026):
// - Aula de estagio DENTRO do turno da turma (encontro com o orientador) conta
//   como choque, como qualquer aula: para o docente e para a turma.
// - Aula de estagio FORA do turno da turma (estagio em campo: escola, laboratorio,
//   empresa, fazenda) NAO gera choque com nada. Os alunos estao em outro lugar e o
//   professor fica livre para dar outras aulas nesse horario.
// As demais componentes nao mudam: sempre contam como choque.

import { normalizeTurnoKey, turnoDaTurmaInclui } from './turns.js?v=202611171437';

// "CBBR049 ESTAGIO III", "Estágio Supervisionado I" -> true.
export function ehEstagio(nomeComponente) {
    const nome = String(nomeComponente || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase();
    return /\bESTAGIO\b/.test(nome);
}

// "14:00 - 14:50" -> 840. Sem hora -> NaN.
function minutosDoInicio(horario) {
    const m = String(horario || '').match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

// Turno de um horario: 'manha', 'tarde' ou 'noite' ('' se nao der para saber).
// 1o procura o rotulo no quadro de horarios (horariosPorTurno: { 'Manhã': [...],
// 'Tarde': [...], 'Noite': [...] }); se nao achar, decide pelo relogio.
export function turnoDoHorario(horario, horariosPorTurno = null) {
    const rotulo = String(horario || '').trim();
    if (!rotulo) return '';
    if (horariosPorTurno && typeof horariosPorTurno === 'object') {
        for (const [turno, lista] of Object.entries(horariosPorTurno)) {
            const chave = normalizeTurnoKey(turno);
            if (!['manha', 'tarde', 'noite'].includes(chave)) continue; // so turnos simples
            if (Array.isArray(lista) && lista.some((s) => String(s || '').trim() === rotulo)) return chave;
        }
    }
    const min = minutosDoInicio(rotulo);
    if (!Number.isFinite(min)) return '';
    if (min < 12 * 60 + 30) return 'manha';
    if (min < 18 * 60) return 'tarde';
    return 'noite';
}

// A aula pode gerar choque? So nao gera quando e estagio fora do turno da turma.
// aula: { disciplina, horario }; turnoDaTurma: turno proprio da turma ("Manhã",
// "Manhã+Tarde"...). Sem turno da turma ou sem horario reconhecido: conta (seguro).
export function aulaContaComoChoque(aula, turnoDaTurma, horariosPorTurno = null) {
    if (!ehEstagio(aula?.disciplina)) return true;
    if (!String(turnoDaTurma || '').trim()) return true;
    const turno = turnoDoHorario(aula?.horario, horariosPorTurno);
    if (!turno) return true;
    return turnoDaTurmaInclui(turnoDaTurma, turno);
}
