-- Cardume - banco compartilhado das alocacoes (MariaDB do CTIC-UFPA)
--
-- Como usar: phpMyAdmin > clicar no banco cardume_iecos (coluna da esquerda)
-- > aba SQL > colar este arquivo > Executar.
-- Pode ser executado mais de uma vez sem perder dados.
--
-- Equivalente a supabase/schema.sql. O que no Supabase era feito pelo banco
-- (login, regras de acesso, carimbo de quem alterou, historico, tempo real)
-- aqui passa a ser feito pela API em PHP, que e a unica a falar com o banco.

-- ===== Tabelas =====

-- Usuarios e quem pode editar o que (no Supabase: auth.users + perfis).
-- id mantem o mesmo uuid do Supabase; senha_hash recebe o bcrypt de la,
-- que o PHP confere com password_verify().
CREATE TABLE IF NOT EXISTS usuarios (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  email           VARCHAR(255) NOT NULL,
  senha_hash      VARCHAR(255) NOT NULL,
  senha_definida  TINYINT(1)   NOT NULL DEFAULT 0,   -- 0 = pedir nova senha no primeiro acesso
  nome            VARCHAR(120) NOT NULL DEFAULT '',
  curso           VARCHAR(10)  NOT NULL DEFAULT '',  -- sigla: EP, CB, CN, MT...
  papel           ENUM('coordenador', 'admin') NOT NULL DEFAULT 'coordenador',
  criado_em       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY usuarios_email_uq (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uma linha por alocacao. "dados" guarda o objeto inteiro que o app usa.
CREATE TABLE IF NOT EXISTS alocacoes (
  id              VARCHAR(100) NOT NULL PRIMARY KEY, -- o mesmo id gerado pelo app
  plano           VARCHAR(100) NOT NULL,             -- chave do periodo: PL1__2027-01-04__2027-03-05
  curso           VARCHAR(10)  NOT NULL,
  turma           VARCHAR(60)  NOT NULL DEFAULT '',
  dados           LONGTEXT     NOT NULL CHECK (JSON_VALID(dados)),
  atualizado_em   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  atualizado_por  CHAR(36)     NULL,
  KEY alocacoes_plano_idx (plano),
  KEY alocacoes_atualizado_idx (atualizado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historico de alteracoes (auditoria e recuperacao). Tambem permite aos
-- navegadores descobrir exclusoes recentes, ja que aqui nao ha tempo real.
CREATE TABLE IF NOT EXISTS alocacoes_historico (
  seq           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  alocacao_id   VARCHAR(100) NOT NULL,
  plano         VARCHAR(100) NULL,
  curso         VARCHAR(10)  NULL,
  acao          ENUM('INSERT', 'UPDATE', 'DELETE') NOT NULL,
  dados_antes   LONGTEXT     NULL,
  dados_depois  LONGTEXT     NULL,
  usuario       CHAR(36)     NULL,
  em            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY alocacoes_historico_alocacao_idx (alocacao_id),
  KEY alocacoes_historico_em_idx (em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Busca das mudancas de um periodo a partir de um numero de sequencia.
CREATE INDEX IF NOT EXISTS alocacoes_historico_plano_seq_idx ON alocacoes_historico (plano, seq);

-- Sessoes de login (cookie do navegador). Guarda so o hash do token.
CREATE TABLE IF NOT EXISTS sessoes (
  token_hash  CHAR(64)  NOT NULL PRIMARY KEY,
  usuario     CHAR(36)  NOT NULL,
  criada_em   DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em   DATETIME  NOT NULL,
  KEY sessoes_usuario_idx (usuario),
  KEY sessoes_expira_idx (expira_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Senhas erradas por e-mail + endereco IP, para bloquear tentativas em serie.
CREATE TABLE IF NOT EXISTS login_tentativas (
  chave     CHAR(64)  NOT NULL PRIMARY KEY,
  falhas    INT       NOT NULL DEFAULT 0,
  primeira  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
