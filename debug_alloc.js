const fs = require('fs');

const data = JSON.parse(fs.readFileSync('d:\\Git\\planejador-academico\\gestor-iecos\\data\\default_data.json', 'utf8'));

// O arquivo acima talvez nao tenha o estado salvo do LocalStorage. A interface usa localStorage?
// O projeto é puramente frontend. Não temos acesso ao localStorage do usuário!!
