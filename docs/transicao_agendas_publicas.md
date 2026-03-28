# Transição Segura das Agendas Públicas

## Objetivo

Manter duas versões públicas coexistindo durante a fase final da refatoração:

- `agenda_discente.html`: versão legada em produção
- `agenda_publica.html`: nova versão em evolução

## Regra principal

A agenda discente legada **não deve ser removida, sobrescrita nem alterada de forma destrutiva** sem:

1. preservação explícita da versão em produção;
2. validação manual do usuário;
3. possibilidade simples de retrocesso.

## Snapshot preservado

Foi criado um snapshot completo da versão da `main` em:

- `[_backups/agenda_discente_main_snapshot_20260328](/d:/Git/planejador-academico/gestor-iecos/_backups/agenda_discente_main_snapshot_20260328)`

Manifesto do snapshot:

- `[_backups/agenda_discente_main_snapshot_20260328/backup_manifest.json](/d:/Git/planejador-academico/gestor-iecos/_backups/agenda_discente_main_snapshot_20260328/backup_manifest.json)`

Arquivos preservados:

- `agenda_discente.html`
- `alocacoes_publicas.json`
- `dados_app.json`
- `css/style.css`
- `js/agenda_discente.js`
- `js/store.js`
- `js/calendar.js`
- `js/utils.js`
- `img/logo_iecos.png`

## Status atual da convivência

- `agenda_discente.html` foi restaurada nesta branch a partir da `main`.
- `agenda_publica.html` permanece como frente da nova organização pública.
- Nenhuma exclusão do legado deve ocorrer em lote.
- `agenda_discente.html` agora aponta para um runtime legado isolado em `legacy/agenda_discente_runtime/`.

## Validação manual mais recente

- Data: `28/03/2026`
- Ambiente: notebook local com Live Server
- URL testada: `http://127.0.0.1:5501/agenda_discente.html`
- Resultado: a agenda discente legada carregou corretamente no notebook
- Consequência: a etapa de isolamento do legado foi liberada e já foi aplicada nesta branch
- Pendência atual: repetir esse mesmo smoke test depois do isolamento para validar o runtime legado já apontando para `legacy/agenda_discente_runtime/`

## Protocolo para remoção lenta de arquivos

Toda remoção futura deve seguir esta ordem:

1. identificar um único arquivo candidato;
2. confirmar se ele é legado, novo ou compartilhado;
3. remover somente esse arquivo;
4. pedir teste manual do usuário;
5. manter a remoção apenas se o teste passar;
6. retroagir imediatamente se houver quebra.

## Arquivos sensíveis

Os seguintes itens devem ser tratados como sensíveis durante a transição:

- `agenda_discente.html`
- `legacy/agenda_discente_runtime/js/agenda_discente.js`
- `legacy/agenda_discente_runtime/js/store.js`
- `legacy/agenda_discente_runtime/js/calendar.js`
- `legacy/agenda_discente_runtime/css/style.css`
- `alocacoes_publicas.json`
- `dados_app.json`

## Direção recomendada

Enquanto a migração não estiver validada:

- manter a URL legada `agenda_discente.html` acessível;
- isolar novas decisões em `agenda_publica.html` e nos novos arquivos de catálogo/configuração;
- evitar reaproveitar nomes do legado para experimentos da nova arquitetura.
