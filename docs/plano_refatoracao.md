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

## Fase 1 - Migracao para o servidor da UFPA (quando a VPN sair)

- [ ] Enviar por FTP so o que o app usa: `index.html`, `agenda_publica.html`,
      `.htaccess`, `dados_app.json`, `alocacoes_publicas.json`, `api/`
      (com `config.php` criado no servidor), `css/`, `img/`, `js/`, `publicacoes/`.
      O resto (`tools/`, `mysql/`, `docs/`, `tests/`, `dados/`...) fica so no Git.
- [ ] Rodar de novo `mysql/schema.sql` no phpMyAdmin (ganhou `sessoes` e `login_tentativas`).
- [ ] Conferir no navegador (F12 > Rede) se `academic_rules.mjs` chega como
      `text/javascript` e se o site abre sem erro 500 (se der, apagar o `.htaccess`).
- [ ] Copiar usuarios e alocacoes do Supabase, virar `DEFAULT_BACKEND_MODE` para `'ufpa'`.
- [ ] Endereco antigo (GitHub Pages) com aviso "o Cardume mudou de endereco".
- [ ] Depois do corte: "Publicar Online" enviando a agenda publica pela API (caminho C).
- [ ] Depois do corte, opcional: tirar os sufixos `??v=` dos imports (o
      `.htaccess` ja garante arquivo novo), o que acaba com o passo 4 da validacao.

Se a UFPA nao sair, nada disso bloqueia: o modo `supabase` continua como esta.

## Fase 2 - Dados para o SIGAA

- [ ] Revisar com o usuario o que a exportacao de metadados SIGAA
      (`sigaa_metadata.js`, botao "Exportar Metadados SIGAA") gera hoje e o que
      falta para o cadastro das turmas no SIGAA.
- [ ] Testes para `buildSigaaMetadataPayload` (hoje sem teste; so o payload
      de `academic_rules.mjs` e testado).

## Fase 3 - Fatiar o `ui.js` (7.092 linhas, 224 funcoes)

Uma extracao por commit, movendo codigo sem reescrever, do mais isolado para o
mais acoplado:

- [ ] Lista de Ofertas -> `ofertas_ui.js` (montagem das linhas ja e quase pura).
- [ ] Exportacoes e importacao (botoes da aba Exportar) -> `exportacoes_ui.js`.
- [ ] Sugestao de inicio e aviso de dia livre -> modulo proprio, com testes.
- [ ] Por ultimo, a grade da aba Alocar Componentes (concentra o estado de
      `weekly_state.js`; so mexer com testes cobrindo o fluxo de faixas).

## Fase 4 - Pendencias pequenas

- [ ] Conflitos de docente: `conflicts.js` (motor) e `conflitos_ui.js`
      (painel global) ainda calculam cada um a sua maneira; unificar no motor.
- [ ] `agenda_publica.js`: a gaveta de detalhes no celular (`abrirBottomSheet`)
      nunca e aberta; decidir se religa ou remove junto com o HTML dela.
- [ ] Estilos inline (`.style`) da interface para classes CSS, aos poucos.
