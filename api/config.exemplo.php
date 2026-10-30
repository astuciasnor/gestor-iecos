<?php
// Modelo da configuracao da API. No servidor:
//   1. copie este arquivo para config.php (na mesma pasta api/);
//   2. preencha a senha do banco (a do documento do CTIC, item "Banco de dados");
//   3. envie config.php pelo FileZilla.
// config.php nunca vai para o Git (.gitignore) e o .htaccess impede abri-lo pelo navegador.
return [
    'db_host'    => 'localhost',
    'db_nome'    => 'cardume_iecos',
    'db_usuario' => 'cardume_iecos',
    'db_senha'   => 'COLOQUE_AQUI_A_SENHA_DO_BANCO',
];
