// Quantas faixas uma componente pode ter. E o UNICO lugar com esse numero:
// tela (js/ui.js), estado (js/weekly_state.js) e linhas do index.html seguem daqui.
// 18/11/2026: passou de 3 para 4 (estagio com manha e noite no mesmo PL, e as
// demais componentes tambem). Ate MAX_FAIXAS - 1 pausas digitadas.
export const MAX_FAIXAS = 4;

// [1, 2, 3, 4]
export const NUMEROS_FAIXAS = Object.freeze(Array.from({ length: MAX_FAIXAS }, (_, i) => i + 1));

// Ids dos campos de data de todas as faixas, na ordem da tabela.
export function idsDatasFaixas() {
    return NUMEROS_FAIXAS.flatMap((i) => [`inp-data-inicio-f${i}`, `inp-data-fim-f${i}`]);
}
