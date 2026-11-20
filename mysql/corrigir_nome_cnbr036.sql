-- Correcao unica (20/11/2026): nome da componente CNBR036 (CN) tinha um link
-- do SIGAA colado no meio. A planilha e o dados_app.json ja foram corrigidos;
-- este SQL troca o nome antigo pelo novo nas alocacoes ja feitas e na agenda
-- publicada (os alunos veem a agenda_publicada).
--
-- Como usar: phpMyAdmin > banco cardume_iecos > aba SQL > colar > Executar.
-- Fazer DEPOIS de enviar o dados_app.json novo pelo FileZilla.
-- Pode rodar de novo sem problema (na segunda vez nao acha nada).

SET @antigo = 'ESTAGIO DOCENTE EM ESPACOS FORMAIS E NAO- https://sigaa.ufpa.br/sigaa/graduacao/curriculo/lista.jsf# FORMAIS';
SET @novo   = 'ESTAGIO DOCENTE EM ESPACOS FORMAIS E NAO-FORMAIS';

-- 1) Antes: quantas linhas tem o nome antigo
SELECT 'alocacoes' AS tabela, COUNT(*) AS linhas FROM alocacoes WHERE INSTR(dados, @antigo) > 0
UNION ALL
SELECT 'agenda_publicada', COUNT(*) FROM agenda_publicada WHERE INSTR(documento, @antigo) > 0;

-- 2) Troca
UPDATE alocacoes        SET dados     = REPLACE(dados, @antigo, @novo)     WHERE INSTR(dados, @antigo) > 0;
UPDATE agenda_publicada SET documento = REPLACE(documento, @antigo, @novo) WHERE INSTR(documento, @antigo) > 0;

-- 3) Depois: tudo deve dar 0
SELECT 'alocacoes' AS tabela, COUNT(*) AS linhas FROM alocacoes WHERE INSTR(dados, @antigo) > 0
UNION ALL
SELECT 'agenda_publicada', COUNT(*) FROM agenda_publicada WHERE INSTR(documento, @antigo) > 0;
