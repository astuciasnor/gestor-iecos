// Unidades academicas do Cardume. Lugar unico: para uma unidade nova, acrescente
// aqui (sigla, nome, subunidades) e preencha a unidade dos cursos dela no
// dados_app.json (cursos[].unidade). Curso sem unidade fica na UNIDADE_PADRAO.
// Sem tela nem store (testavel no Node).

// Unidade em que o Cardume abre e a dos cursos sem unidade marcada.
export const UNIDADE_PADRAO = 'IECOS';

// Unidades com subunidades conhecidas. Professor de outra unidade: o coordenador
// digita unidade e subunidade (ex.: CANAN / FACFIS) e o administrador confere.
export const OUTRA_UNIDADE = 'OUTRA';
export const UNIDADES = [
    { sigla: 'IECOS', nome: 'IECOS', subunidades: ['FEPESCA', 'FACIN', 'FBIO'] },
    { sigla: 'CBRAG', nome: 'Campus Bragança', subunidades: ['FACED', 'FAHIST', 'FAMAT', 'FALE', 'FALEST'] },
    { sigla: 'CANAN', nome: 'Campus de Ananindeua', subunidades: ['FACFIS'] }
];

// Sigla da unidade de um curso ({ unidade } do dados_app.json), em maiusculas.
export function unidadeDoCurso(curso) {
    return String(curso?.unidade || '').trim().toUpperCase() || UNIDADE_PADRAO;
}
