// Texto: funcoes puras (sem tela) usadas por varias partes do app.

// Para pôr texto dentro de HTML (conteudo ou atributo) sem quebrar a pagina:
// troca & < > " ' pelas entidades.
export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

// Chave para comparar nomes (turma, componente, docente): sem espacos nas pontas, maiuscula.
export function normalizeKeyPart(value) {
    return String(value || '').trim().toUpperCase();
}
