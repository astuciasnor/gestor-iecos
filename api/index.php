<?php
// Cardume - API do servidor da UFPA (PHP + MariaDB).
//
// Faz o papel que o Supabase faz no modo 'supabase': login, troca de senha,
// regras de quem pode alterar cada curso, carimbo de quem alterou, historico
// e a lista de mudancas que os navegadores consultam a cada poucos segundos.
// O navegador so fala com este arquivo; so ele fala com o banco.
//
// Chamadas (sempre api/?acao=...):
//   GET  sessao                    quem esta logado (ou usuario: null)
//   POST entrar   {email, senha}
//   POST sair
//   POST senha    {senha}          troca a senha do usuario logado
//   GET  plano    &plano=K         alocacoes do periodo K + cursor
//   GET  mudancas &plano=K&desde=N mudancas do periodo K depois do cursor N
//   POST salvar   {linhas: [{id, plano, curso, turma, dados}]}
//   POST excluir  {ids: [...]}
// Todo POST exige o cabecalho "X-Cardume: 1" (barra envio a partir de outros sites).

declare(strict_types=1);

const SESSAO_COOKIE = 'cardume_sessao';
const SESSAO_DIAS = 30;
const MAX_FALHAS = 8;            // senhas erradas seguidas por e-mail + IP...
const JANELA_FALHAS_MIN = 15;    // ...dentro desta janela, em minutos
const MIN_SENHA = 8;
const MAX_LINHAS = 200;          // por chamada de salvar/excluir
const MAX_MUDANCAS = 1000;       // por chamada de mudancas
const MAX_CORPO = 16 * 1024 * 1024;
const JSON_OPCOES = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION;

final class ErroApi extends Exception
{
    public function __construct(public int $status, string $mensagem, public string $codigo = '')
    {
        parent::__construct($mensagem);
    }
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

set_exception_handler(function (Throwable $e): void {
    if ($e instanceof ErroApi) {
        $corpo = ['erro' => $e->getMessage()];
        if ($e->codigo !== '') $corpo['codigo'] = $e->codigo;
        responder($e->status, $corpo);
    }
    error_log('[cardume] ' . $e);
    responder(500, ['erro' => 'erro interno do servidor']);
});

// CARDUME_CONFIG so existe no servidor de teste local (tools/servidor_local).
$arquivoConfig = getenv('CARDUME_CONFIG') ?: __DIR__ . '/config.php';
if (!is_file($arquivoConfig)) throw new ErroApi(500, 'api/config.php nao encontrado no servidor');
$config = require $arquivoConfig;
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$db = new mysqli($config['db_host'], $config['db_usuario'], $config['db_senha'], $config['db_nome']);
$db->set_charset('utf8mb4');

$rotas = [
    'GET sessao'    => 'acaoSessao',
    'POST entrar'   => 'acaoEntrar',
    'POST sair'     => 'acaoSair',
    'POST senha'    => 'acaoSenha',
    'GET plano'     => 'acaoPlano',
    'GET mudancas'  => 'acaoMudancas',
    'POST salvar'   => 'acaoSalvar',
    'POST excluir'  => 'acaoExcluir',
];
$metodo = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$rota = $metodo . ' ' . (string) ($_GET['acao'] ?? '');
if (!isset($rotas[$rota])) throw new ErroApi(404, 'acao desconhecida');
if ($metodo === 'POST' && ($_SERVER['HTTP_X_CARDUME'] ?? '') !== '1') {
    throw new ErroApi(403, 'requisicao recusada');
}
$rotas[$rota]($db);

// ===== Acoes =====

function acaoSessao(mysqli $db): void
{
    $u = usuarioLogado($db);
    if ($u) renovarSessao($db);
    responder(200, $u ? respostaUsuario($u) : ['usuario' => null, 'perfil' => null]);
}

function acaoEntrar(mysqli $db): void
{
    $corpo = corpoJson();
    $email = mb_strtolower(trim((string) ($corpo->email ?? '')));
    $senha = (string) ($corpo->senha ?? '');
    if ($email === '' || $senha === '') throw new ErroApi(400, 'Informe e-mail e senha.');

    $chave = hash('sha256', $email . '|' . ($_SERVER['REMOTE_ADDR'] ?? ''));
    $db->query('DELETE FROM login_tentativas WHERE primeira < NOW() - INTERVAL ' . JANELA_FALHAS_MIN . ' MINUTE');
    $falhas = (int) (consultarUm($db, 'SELECT falhas FROM login_tentativas WHERE chave = ?', [$chave])['falhas'] ?? 0);
    if ($falhas >= MAX_FALHAS) {
        throw new ErroApi(429, 'Muitas tentativas com senha errada. Aguarde ' . JANELA_FALHAS_MIN . ' minutos e tente de novo.');
    }

    $u = consultarUm($db, 'SELECT * FROM usuarios WHERE email = ?', [$email]);
    // Sem usuario, confere contra um hash qualquer para gastar o mesmo tempo.
    $hash = $u['senha_hash'] ?? password_hash('cardume', PASSWORD_DEFAULT);
    if (!password_verify($senha, $hash) || !$u) {
        executar($db, 'INSERT INTO login_tentativas (chave, falhas) VALUES (?, 1)
                       ON DUPLICATE KEY UPDATE falhas = falhas + 1', [$chave]);
        throw new ErroApi(401, 'E-mail ou senha incorretos.', 'credenciais_invalidas');
    }
    executar($db, 'DELETE FROM login_tentativas WHERE chave = ?', [$chave]);

    // Hash vindo do Supabase ($2a$) passa ao formato atual do PHP no primeiro login.
    if (password_needs_rehash($hash, PASSWORD_DEFAULT)) {
        executar($db, 'UPDATE usuarios SET senha_hash = ? WHERE id = ?', [password_hash($senha, PASSWORD_DEFAULT), $u['id']]);
    }

    $db->query('DELETE FROM sessoes WHERE expira_em < NOW()');
    $token = bin2hex(random_bytes(32));
    executar($db, 'INSERT INTO sessoes (token_hash, usuario, expira_em)
                   VALUES (?, ?, NOW() + INTERVAL ' . SESSAO_DIAS . ' DAY)', [hash('sha256', $token), $u['id']]);
    gravarCookie($token, time() + SESSAO_DIAS * 86400);
    responder(200, respostaUsuario($u));
}

function acaoSair(mysqli $db): void
{
    $token = $_COOKIE[SESSAO_COOKIE] ?? '';
    if (is_string($token) && $token !== '') {
        executar($db, 'DELETE FROM sessoes WHERE token_hash = ?', [hash('sha256', $token)]);
    }
    gravarCookie('', time() - 3600);
    responder(200, ['ok' => true]);
}

function acaoSenha(mysqli $db): void
{
    $u = exigirUsuario($db);
    $nova = (string) (corpoJson()->senha ?? '');
    if (mb_strlen($nova) < MIN_SENHA) throw new ErroApi(400, 'A senha precisa ter pelo menos ' . MIN_SENHA . ' caracteres.');
    if (strlen($nova) > 72) throw new ErroApi(400, 'A senha pode ter no maximo 72 caracteres.');
    if (password_verify($nova, $u['senha_hash'])) throw new ErroApi(400, 'A nova senha precisa ser diferente da atual.');

    executar($db, 'UPDATE usuarios SET senha_hash = ?, senha_definida = 1 WHERE id = ?', [password_hash($nova, PASSWORD_DEFAULT), $u['id']]);
    // Outras sessoes abertas com a senha antiga deixam de valer.
    executar($db, 'DELETE FROM sessoes WHERE usuario = ? AND token_hash <> ?', [$u['id'], hash('sha256', (string) $_COOKIE[SESSAO_COOKIE])]);
    $u['senha_definida'] = 1;
    responder(200, respostaUsuario($u));
}

function acaoPlano(mysqli $db): void
{
    exigirUsuario($db);
    $plano = textoParametro('plano', 100);
    // Cursor e alocacoes lidos na mesma fotografia do banco: nenhuma mudanca
    // fica de fora da lista nem da proxima consulta de mudancas.
    $db->query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    $cursor = ultimoSeq($db);
    $linhas = consultar($db, 'SELECT dados FROM alocacoes WHERE plano = ? ORDER BY id', [$plano]);
    $db->commit();
    $dados = array_map(fn ($l) => $l['dados'], $linhas);
    responderBruto('{"alocacoes":[' . implode(',', $dados) . '],"cursor":' . $cursor . '}');
}

function acaoMudancas(mysqli $db): void
{
    $u = exigirUsuario($db);
    $plano = textoParametro('plano', 100);
    $desde = filter_var($_GET['desde'] ?? '', FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
    if ($desde === false) throw new ErroApi(400, 'parametro desde invalido');

    $db->query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    $cursor = max($desde, ultimoSeq($db));
    $linhas = consultar($db, 'SELECT seq, acao, alocacao_id, dados_depois FROM alocacoes_historico
                              WHERE plano = ? AND seq > ? ORDER BY seq LIMIT ' . MAX_MUDANCAS, [$plano, $desde]);
    $db->commit();
    if (count($linhas) === MAX_MUDANCAS) $cursor = (int) end($linhas)['seq'];

    $itens = array_map(function ($l) {
        $base = '{"acao":' . json_encode($l['acao']) . ',"id":' . json_encode($l['alocacao_id'], JSON_OPCOES);
        return $l['acao'] === 'DELETE' ? $base . '}' : $base . ',"dados":' . $l['dados_depois'] . '}';
    }, $linhas);
    responderBruto('{"mudancas":[' . implode(',', $itens) . '],"cursor":' . $cursor
        . ',"usuario":' . json_encode($u['id']) . '}');
}

function acaoSalvar(mysqli $db): void
{
    $u = exigirUsuario($db);
    $linhas = corpoJson()->linhas ?? null;
    if (!is_array($linhas) || count($linhas) > MAX_LINHAS) throw new ErroApi(400, 'lista de alocacoes invalida');

    $validas = [];
    foreach ($linhas as $l) {
        if (!is_object($l)) throw new ErroApi(400, 'alocacao invalida');
        $id = textoCampo($l->id ?? null, 'id', 100, false);
        $dados = $l->dados ?? null;
        if (!is_object($dados) || ($dados->id ?? null) !== $id) throw new ErroApi(400, "alocacao $id sem dados validos");
        $validas[] = [
            'id' => $id,
            'plano' => textoCampo($l->plano ?? null, 'plano', 100, false),
            'curso' => textoCampo($l->curso ?? '', 'curso', 10, true),
            'turma' => textoCampo($l->turma ?? '', 'turma', 60, true),
            'dados' => json_encode($dados, JSON_OPCOES | JSON_THROW_ON_ERROR),
        ];
    }

    emEscritaExclusiva($db, function () use ($db, $u, $validas) {
        foreach ($validas as $l) {
            $antes = consultarUm($db, 'SELECT curso, dados FROM alocacoes WHERE id = ? FOR UPDATE', [$l['id']]);
            if (!podeEditar($u, $l['curso']) || ($antes && !podeEditar($u, $antes['curso']))) {
                throw new ErroApi(403, 'sem permissao para alterar este curso');
            }
            executar($db, 'INSERT INTO alocacoes (id, plano, curso, turma, dados, atualizado_em, atualizado_por)
                           VALUES (?, ?, ?, ?, ?, NOW(3), ?)
                           ON DUPLICATE KEY UPDATE plano = VALUES(plano), curso = VALUES(curso), turma = VALUES(turma),
                             dados = VALUES(dados), atualizado_em = NOW(3), atualizado_por = VALUES(atualizado_por)',
                [$l['id'], $l['plano'], $l['curso'], $l['turma'], $l['dados'], $u['id']]);
            if ($antes && $antes['dados'] === $l['dados']) continue;
            executar($db, 'INSERT INTO alocacoes_historico (alocacao_id, plano, curso, acao, dados_antes, dados_depois, usuario)
                           VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$l['id'], $l['plano'], $l['curso'], $antes ? 'UPDATE' : 'INSERT', $antes['dados'] ?? null, $l['dados'], $u['id']]);
        }
    });
    responder(200, ['ok' => true]);
}

function acaoExcluir(mysqli $db): void
{
    $u = exigirUsuario($db);
    $ids = corpoJson()->ids ?? null;
    if (!is_array($ids) || count($ids) > MAX_LINHAS) throw new ErroApi(400, 'lista de ids invalida');
    $ids = array_map(fn ($id) => textoCampo($id, 'id', 100, false), $ids);

    emEscritaExclusiva($db, function () use ($db, $u, $ids) {
        foreach ($ids as $id) {
            $antes = consultarUm($db, 'SELECT plano, curso, dados FROM alocacoes WHERE id = ? FOR UPDATE', [$id]);
            if (!$antes) continue;
            if (!podeEditar($u, $antes['curso'])) throw new ErroApi(403, 'sem permissao para alterar este curso');
            executar($db, 'DELETE FROM alocacoes WHERE id = ?', [$id]);
            executar($db, 'INSERT INTO alocacoes_historico (alocacao_id, plano, curso, acao, dados_antes, usuario)
                           VALUES (?, ?, ?, \'DELETE\', ?, ?)',
                [$id, $antes['plano'], $antes['curso'], $antes['dados'], $u['id']]);
        }
    });
    responder(200, ['ok' => true]);
}

// ===== Usuario e sessao =====

function usuarioLogado(mysqli $db): ?array
{
    $token = $_COOKIE[SESSAO_COOKIE] ?? '';
    if (!is_string($token) || $token === '') return null;
    return consultarUm($db, 'SELECT u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario
                             WHERE s.token_hash = ? AND s.expira_em > NOW()', [hash('sha256', $token)]);
}

function exigirUsuario(mysqli $db): array
{
    $u = usuarioLogado($db);
    if (!$u) throw new ErroApi(401, 'sessao expirada, entre novamente', 'sessao_expirada');
    return $u;
}

// Quem continua usando o app nao precisa entrar de novo a cada 30 dias.
function renovarSessao(mysqli $db): void
{
    $token = (string) $_COOKIE[SESSAO_COOKIE];
    executar($db, 'UPDATE sessoes SET expira_em = NOW() + INTERVAL ' . SESSAO_DIAS . ' DAY WHERE token_hash = ?', [hash('sha256', $token)]);
    gravarCookie($token, time() + SESSAO_DIAS * 86400);
}

function gravarCookie(string $valor, int $expira): void
{
    $https = ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    setcookie(SESSAO_COOKIE, $valor, [
        'expires' => $expira,
        'path' => '/',
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function respostaUsuario(array $u): array
{
    $semCurso = $u['curso'] === '' && $u['papel'] !== 'admin';
    return [
        'usuario' => ['id' => $u['id'], 'email' => $u['email'], 'senha_definida' => (bool) $u['senha_definida']],
        'perfil' => $semCurso ? null : ['nome' => $u['nome'], 'curso' => $u['curso'], 'papel' => $u['papel']],
    ];
}

function podeEditar(array $u, string $curso): bool
{
    if ($u['papel'] === 'admin') return true;
    return $curso !== '' && strtoupper($u['curso']) === strtoupper($curso);
}

// ===== Banco =====

// Uma escrita por vez: assim a ordem dos numeros do historico (seq) e a ordem
// em que as mudancas ficam visiveis, e nenhum navegador pula uma mudanca.
function emEscritaExclusiva(mysqli $db, callable $fn): void
{
    $trava = consultarUm($db, "SELECT GET_LOCK('cardume_escrita', 15) AS ok");
    if ((int) ($trava['ok'] ?? 0) !== 1) throw new ErroApi(503, 'servidor ocupado, tente de novo');
    try {
        $db->begin_transaction();
        try {
            $fn();
            $db->commit();
        } catch (Throwable $e) {
            $db->rollback();
            throw $e;
        }
    } finally {
        $db->query("SELECT RELEASE_LOCK('cardume_escrita')");
    }
}

function ultimoSeq(mysqli $db): int
{
    return (int) (consultarUm($db, 'SELECT COALESCE(MAX(seq), 0) AS seq FROM alocacoes_historico')['seq'] ?? 0);
}

function executar(mysqli $db, string $sql, array $params = []): mysqli_stmt
{
    $stmt = $db->prepare($sql);
    if ($params) $stmt->bind_param(str_repeat('s', count($params)), ...$params);
    $stmt->execute();
    return $stmt;
}

function consultar(mysqli $db, string $sql, array $params = []): array
{
    return executar($db, $sql, $params)->get_result()->fetch_all(MYSQLI_ASSOC);
}

function consultarUm(mysqli $db, string $sql, array $params = []): ?array
{
    return consultar($db, $sql, $params)[0] ?? null;
}

// ===== Entrada e saida =====

function corpoJson(): object
{
    $bruto = file_get_contents('php://input', false, null, 0, MAX_CORPO + 1);
    if ($bruto === false || strlen($bruto) > MAX_CORPO) throw new ErroApi(413, 'envio grande demais');
    // Objetos continuam objetos (stdClass): {} vazio nao vira [] ao regravar.
    $corpo = json_decode($bruto, false);
    if (!is_object($corpo)) throw new ErroApi(400, 'corpo JSON invalido');
    return $corpo;
}

function textoParametro(string $nome, int $max): string
{
    return textoCampo($_GET[$nome] ?? null, $nome, $max, false);
}

function textoCampo(mixed $valor, string $nome, int $max, bool $vazioOk): string
{
    if (!is_string($valor) || mb_strlen($valor) > $max || (!$vazioOk && $valor === '')) {
        throw new ErroApi(400, "campo $nome invalido");
    }
    return $valor;
}

function responder(int $status, array $dados): never
{
    http_response_code($status);
    echo json_encode($dados, JSON_OPCOES);
    exit;
}

function responderBruto(string $json): never
{
    http_response_code(200);
    echo $json;
    exit;
}
