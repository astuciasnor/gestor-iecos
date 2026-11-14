# Plano de refatoracao do Cardume

Plano curto e incremental. Substitui `plano_limpeza_priorizado.md`,
`instrucoes_fatiamento_ui.md` e `plano_refatoracao_ampla.html` (continuam no
historico do Git). Cada passo e pequeno, nao muda o comportamento visivel e vai
num commit proprio, depois de testado.

## Como validar cada passo

1. `node --check` nos arquivos alterados e `npm test` (todas as suites de `tests/`).
2. Abrir o app e passar pelas abas que usam o codigo alterado.
3. Abrir `agenda_publica.html` se o passo tocar algo que ela importa
   (`calendar.js`, `store.js`, `turns.js`, `academic_rules.mjs`).
4. Enquanto o app estiver no GitHub Pages: subir a versao `??v=` do `ui.js` em
   `js/main.js` e a do `main.js` em `index.html`, senao o navegador pode
   continuar com o arquivo antigo. No servidor da UFPA o `.htaccess` da raiz
   resolve isso (ver fase 1).

Regras que continuam valendo: modulo novo nunca importa de `ui.js`; editar
arquivos sempre em UTF-8; um mesmo modulo deve ser importado sempre pelo mesmo
endereco (`./calendar.js` e `./calendar.js??v=x` viram dois modulos separados
no navegador).

## Fase 0 - Higiene (feita em 2026-10-31)

- Codigo morto removido (~2.600 linhas): o modulo `gantt_bidimensional.js`
  inteiro (o Gantt do app usa `renderTeacherClassicGantt` desde jul/2026; o
  bidimensional so era importado, nunca chamado) e 42 funcoes que nada chamava
  (impressao antiga do Gantt, lupa de detalhes do Gantt, contagens de dias
  uteis antigas, detector de conflitos antigo, etc.).
- ~50 imports sem uso tirados do `ui.js`, `gantt_ui.js`, `conflitos_ui.js` e `main.js`.
- `calendar.js` passou a ser importado por um endereco so (antes o navegador
  carregava duas copias dele).
- Corrigido: os botoes "Ciente" e "Nao avisar mais" do aviso de dia livre
  antes da sugestao de inicio nao faziam nada (nunca tinham sido ligados).
- Docs obsoletos e imagens sem uso apagados; manual do desenvolvedor com a
  estrutura atual; `package.json` so para `npm test`.
- `.htaccess` na raiz para o servidor da UFPA.

## Limpeza de 07/11/2026 (depois da pausa, do redesenho do Alocar e das cores suaves)

- Revisao do codigo do dia (pausa entre faixas, avisos no cartao Proximo passo,
  cartao de feriado, tons suaves nos calendarios e na agenda): sem falhas;
  `npm test` (119), `npm run smoke` e `tools/teste_pausa_intercalada.mjs` verdes.
- Aba Ajuda refeita por temas (`js/ajuda_ui.js`, `css/ajuda.css`); o CSS antigo
  dela saiu do `style.css` e do `<style>` do `index.html`.
- CSS morto removido: marcador de feriado antigo (`weekly-holiday-column-*`) e
  `fp-sep`/`fp-grupo`/`fp-hora` da tabela de faixas.
- `applySidebarLayoutFixes` (ui.js) varria a pagina inteira procurando os
  titulos "Oferta de disciplina" e "Gerenciando arquivos" e punha uma linha
  tambem em textos da Ajuda; agora so olha a barra lateral.
- Import sem uso (`formatTurnoOfertaLabel` no `gantt_ui.js`) e aviso escondido
  e obsoleto da barra lateral removidos.

Pendente (pequeno, sem pressa):
- [~] `css/alocar-componentes.css`: declaracoes mortas tiradas em 13/11 (ver abaixo); restam 23 seletores repetidos (regras acrescentadas
      por partes no redesenho). Juntar so com comparacao dos estilos calculados
      antes/depois (a ordem das regras importa).
- [ ] `applySidebarLayoutFixes`: trocar os ajustes por texto por classes no
      `index.html` + CSS.

## Noite de 13 para 14/11/2026 (branch `refatoracao`)

Revisao dos commits desde 06/11 + refatoracao leve, com a regra "nada muda na
tela". Cada passo num commit, conferido com `npm test`, `npm run smoke`, os testes
de navegador de `tools/` e as fotos abaixo.

- Ferramentas novas de conferencia (rodar antes e depois de mexer):
  `node tools/foto_telas.mjs antes.json` / `... depois.json --comparar antes.json`
  (texto da Lista de Ofertas, calendario mensal e grade de todas as turmas em
  PL2 e PL4 de 2027, 12 docentes e Indicadores) e `tools/foto_estilos.mjs`
  (estilos calculados da aba Alocar em 860/1200/1400/1700 px, com e sem
  componente em edicao, animacoes desligadas).
- Revisao: sem falha grave. Corrigido: disciplina e docente entravam sem escape
  no HTML da grade e da Lista de Ofertas (cd9313c).
- Defeito "salvar guarda metade da CH" corrigido (d07f132) com teste
  `tools/teste_metade_ch.mjs`.
- CSS: 64 declaracoes mortas e 13 regras vazias fora do `alocar-componentes.css`
  (aeb2c07). Restam 23 seletores repetidos sem sobreposicao; junta-los exige
  mover regras (muda a ordem da cascata): so com a foto de estilos.
- `ui.js` 8.892 -> 8.038 linhas: `js/lista_ofertas_ui.js` (2259fd8) e
  `js/cadastro_docente_ui.js` (2fd0779). Padrao: o modulo exporta
  `ligarX({ ...funcoes do ui.js })`, chamado no ui.js onde o bloco estava
  (funcoes declaradas com `function` ja existem nesse momento).
- Cuidado ao extrair com script: `...nome` (espalhar) tambem precisa do prefixo
  `ligacoes.`; conferir com uma busca por nomes do topo do ui.js sem prefixo.

Observacao (nao mexido): salvar ou Trocar recalcula as datas de TODAS as turmas
do PL aberto (`syncAllIntensiveDates`). Turmas de outro curso podem mudar (ex.:
CN/CB2027 com a Recepcao dos Calouros); para o administrador essas mudancas vao
para o servidor sem aviso; para coordenador sao barradas e voltam.

Proximos candidatos: selecao da grade (arrastar/Shift+clique, ver memoria),
Trocar + "Como resolver?", Unidade/Curso da barra lateral.

## Fase 1 - Migracao para o servidor da UFPA (quando a VPN sair)

- [x] Compactacao do JSON no `.htaccess` (05/11/2026): a agenda da API ia com
      1,1 MB sem compactar. A lista do `.htaccess` substitui a do servidor.
- [ ] Enviar por FTP so o que o app usa: `index.html`, `agenda_publica.html`,
      `.htaccess`, `dados_app.json`, `alocacoes_publicas.json`, `api/`
      (com `config.php` criado no servidor), `css/`, `img/`, `js/`, `publicacoes/`.
      O resto (`tools/`, `mysql/`, `docs/`, `tests/`, `dados/`...) fica so no Git.
- [ ] Rodar de novo `mysql/schema.sql` no phpMyAdmin (ganhou `sessoes` e `login_tentativas`).
- [ ] Conferir no navegador (F12 > Rede) se `academic_rules.mjs` chega como
      `text/javascript` e se o site abre sem erro 500 (se der, apagar o `.htaccess`).
- [x] Copiar usuarios e alocacoes do Supabase, virar `DEFAULT_BACKEND_MODE` para `'ufpa'` (virada em 05/11/2026).
- [x] Endereco antigo (GitHub Pages) com aviso "o Cardume mudou de endereco" (`mudou.html`).
- [x] Depois do corte: "Publicar Online" enviando a agenda publica pela API (caminho C).
- [ ] Depois do corte, opcional: tirar os sufixos `??v=` dos imports (o
      `.htaccess` ja garante arquivo novo), o que acaba com o passo 4 da validacao.

Se a UFPA nao sair, nada disso bloqueia: o modo `supabase` continua como esta.

## Fase 2 - Dados para o SIGAA

- [ ] Revisar com o usuario o que a exportacao de metadados SIGAA
      (`sigaa_metadata.js`, botao "Exportar Metadados SIGAA") gera hoje e o que
      falta para o cadastro das turmas no SIGAA.
- [x] Testes do codigo de horario SIGAA (`tests/sigaa.test.mjs`, 05/11/2026).
- [ ] Testes para `buildSigaaMetadataPayload` (o payload inteiro).

## Fase 3 - Fatiar o `ui.js` (7.250 linhas em 05/11/2026)

Uma extracao por commit, movendo codigo sem reescrever, do mais isolado para o
mais acoplado. Conferencia de cada extracao: alem de `npm test` e
`npm run smoke`, comparar a Lista de Ofertas e o arquivo SIGAA de todas as
turmas antes e depois (tem que dar identico).

- [x] Codigo de horario SIGAA (`getSigaaCode`, `buildScopedSigaaAllocationFromOfferFaixa`)
      -> `sigaa_metadata.js`; `getGanttTurnoCode` -> `turno_helpers.js` (05/11/2026).
- [ ] Lista de Ofertas + Trocar -> `ofertas_ui.js`. Mais acoplada do que parecia:
      usa 16 funcoes internas do `ui.js` (editor, desfazer, grade semanal,
      conflitos do candidato) e e chamada de 9 lugares. Fazer depois da virada,
      recebendo essas funcoes num objeto de contexto (`initOfertasUI({...})`),
      ja que modulo novo nao importa de `ui.js`.
- [ ] Exportacoes e importacao (botoes da aba Exportar) -> `exportacoes_ui.js`.
- [ ] Sugestao de inicio e aviso de dia livre -> modulo proprio, com testes.
- [ ] Por ultimo, a grade da aba Alocar Componentes (concentra o estado de
      `weekly_state.js`; so mexer com testes cobrindo o fluxo de faixas).

## Fase 4 - Pendencias pequenas

- [ ] Conflitos de docente: `conflicts.js` (motor) e `conflitos_ui.js`
      (painel global) ainda calculam cada um a sua maneira; unificar no motor.
- [x] `agenda_publica.js`: a gaveta de detalhes no celular, que nunca abria,
      foi removida com o HTML e o CSS dela (05/11/2026; a lupa continua).
- [ ] Estilos inline (`.style`) da interface para classes CSS, aos poucos.
