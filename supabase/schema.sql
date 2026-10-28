-- Cardume - banco compartilhado das alocacoes (Supabase / PostgreSQL)
--
-- Como usar: Supabase > SQL Editor > New query > colar este arquivo > Run.
-- Pode ser executado mais de uma vez sem perder dados.
--
-- Estrutura pensada para migrar depois ao MySQL/MariaDB do CTIC-UFPA:
-- as mesmas colunas existem la (dados = coluna JSON).

-- ===== Tabelas =====

-- Quem pode editar o que. Uma linha por usuario do Authentication.
create table if not exists public.perfis (
  usuario uuid primary key references auth.users (id) on delete cascade,
  nome    text not null default '',
  curso   text not null default '',            -- sigla: EP, CB, CN, MT...
  papel   text not null default 'coordenador'
          check (papel in ('coordenador', 'admin'))
);

-- Uma linha por alocacao. "dados" guarda o objeto inteiro que o app usa.
create table if not exists public.alocacoes (
  id             text primary key,             -- o mesmo id gerado pelo app
  plano          text not null,                -- chave do periodo: PL1__2027-01-04__2027-03-05
  curso          text not null,
  turma          text not null default '',
  dados          jsonb not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references auth.users (id) on delete set null
);
create index if not exists alocacoes_plano_idx on public.alocacoes (plano);

-- Historico de alteracoes (para auditoria e recuperacao).
create table if not exists public.alocacoes_historico (
  seq          bigint generated always as identity primary key,
  alocacao_id  text not null,
  plano        text,
  curso        text,
  acao         text not null,                  -- INSERT / UPDATE / DELETE
  dados_antes  jsonb,
  dados_depois jsonb,
  usuario      uuid,
  em           timestamptz not null default now()
);
create index if not exists alocacoes_historico_alocacao_idx on public.alocacoes_historico (alocacao_id);

-- ===== Funcoes e gatilhos =====

-- true se o usuario logado pode alterar alocacoes do curso informado.
create or replace function public.pode_editar_curso(c text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfis p
    where p.usuario = auth.uid()
      and (p.papel = 'admin' or upper(p.curso) = upper(c))
  );
$$;

create or replace function public.eh_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.perfis p where p.usuario = auth.uid() and p.papel = 'admin');
$$;

-- Carimba quem alterou e quando (o app nao precisa enviar).
create or replace function public.alocacoes_carimbo()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

drop trigger if exists alocacoes_carimbo on public.alocacoes;
create trigger alocacoes_carimbo
  before insert or update on public.alocacoes
  for each row execute function public.alocacoes_carimbo();

create or replace function public.alocacoes_registrar_historico()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.alocacoes_historico (alocacao_id, plano, curso, acao, dados_antes, usuario)
    values (old.id, old.plano, old.curso, tg_op, old.dados, auth.uid());
    return old;
  end if;
  if tg_op = 'UPDATE' and new.dados = old.dados then
    return new;
  end if;
  insert into public.alocacoes_historico (alocacao_id, plano, curso, acao, dados_antes, dados_depois, usuario)
  values (new.id, new.plano, new.curso, tg_op,
          case when tg_op = 'UPDATE' then old.dados end, new.dados, auth.uid());
  return new;
end;
$$;

drop trigger if exists alocacoes_historico on public.alocacoes;
create trigger alocacoes_historico
  after insert or update or delete on public.alocacoes
  for each row execute function public.alocacoes_registrar_historico();

-- ===== Regras de acesso (RLS) =====

alter table public.perfis enable row level security;
alter table public.alocacoes enable row level security;
alter table public.alocacoes_historico enable row level security;

drop policy if exists perfis_leitura on public.perfis;
create policy perfis_leitura on public.perfis
  for select to authenticated using (true);

drop policy if exists alocacoes_leitura on public.alocacoes;
create policy alocacoes_leitura on public.alocacoes
  for select to authenticated using (true);

drop policy if exists alocacoes_inclusao on public.alocacoes;
create policy alocacoes_inclusao on public.alocacoes
  for insert to authenticated with check (public.pode_editar_curso(curso));

drop policy if exists alocacoes_alteracao on public.alocacoes;
create policy alocacoes_alteracao on public.alocacoes
  for update to authenticated
  using (public.pode_editar_curso(curso))
  with check (public.pode_editar_curso(curso));

drop policy if exists alocacoes_exclusao on public.alocacoes;
create policy alocacoes_exclusao on public.alocacoes
  for delete to authenticated using (public.pode_editar_curso(curso));

drop policy if exists historico_leitura on public.alocacoes_historico;
create policy historico_leitura on public.alocacoes_historico
  for select to authenticated using (public.eh_admin());

-- Permissoes explicitas (o projeto nao expoe tabelas novas automaticamente).
revoke all on public.perfis, public.alocacoes, public.alocacoes_historico from anon;
grant usage on schema public to authenticated;
grant select on public.perfis to authenticated;
grant select, insert, update, delete on public.alocacoes to authenticated;
grant select on public.alocacoes_historico to authenticated;
grant execute on function public.pode_editar_curso(text) to authenticated;
grant execute on function public.eh_admin() to authenticated;

-- ===== Tempo real =====
-- Avisa os navegadores conectados quando uma alocacao muda.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alocacoes'
  ) then
    alter publication supabase_realtime add table public.alocacoes;
  end if;
end;
$$;
