<?php
// Cria (ou atualiza) um usuario no servidor de teste local.
// Uso: php criar_usuario.php EMAIL SENHA NOME CURSO PAPEL [definida]
//   PAPEL: coordenador | admin;  "definida" pula a troca obrigatoria de senha.
declare(strict_types=1);

if ($argc < 6) {
    fwrite(STDERR, "Uso: php criar_usuario.php EMAIL SENHA NOME CURSO PAPEL [definida]\n");
    exit(1);
}
[, $email, $senha, $nome, $curso, $papel] = $argv;
$definida = ($argv[6] ?? '') === 'definida' ? 1 : 0;

$c = require getenv('CARDUME_CONFIG');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$db = new mysqli($c['db_host'], $c['db_usuario'], $c['db_senha'], $c['db_nome']);
$db->set_charset('utf8mb4');

$id = sprintf('%s-%s-4%s-a%s-%s', bin2hex(random_bytes(4)), bin2hex(random_bytes(2)),
    substr(bin2hex(random_bytes(2)), 1), substr(bin2hex(random_bytes(2)), 1), bin2hex(random_bytes(6)));
$stmt = $db->prepare('INSERT INTO usuarios (id, email, senha_hash, senha_definida, nome, curso, papel)
                      VALUES (?, ?, ?, ?, ?, ?, ?)
                      ON DUPLICATE KEY UPDATE senha_hash = VALUES(senha_hash), senha_definida = VALUES(senha_definida),
                        nome = VALUES(nome), curso = VALUES(curso), papel = VALUES(papel)');
$hash = password_hash($senha, PASSWORD_DEFAULT);
$email = mb_strtolower($email);
$stmt->bind_param('sssisss', $id, $email, $hash, $definida, $nome, $curso, $papel);
$stmt->execute();
echo "ok: $email ($papel $curso)\n";
