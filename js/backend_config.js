// Onde ficam as alocacoes:
//   'local'    - somente no navegador (exportar/importar JSON);
//   'supabase' - banco compartilhado online, com login por coordenador;
//   'ufpa'     - o mesmo, no servidor da UFPA (API PHP em api/ + MariaDB).
// Para testar sem mudar o padrao: abra o app com ?backend=ufpa (ou supabase, local);
// a escolha fica gravada neste navegador.
export const DEFAULT_BACKEND_MODE = 'local';

// Chave publica (publishable): pode ficar no codigo; a protecao vem das
// regras de acesso do banco (supabase/schema.sql).
export const SUPABASE_URL = 'https://gwkhjfxknjzvgbuiaior.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_IhUhwTft-8rVDcgTCH2UTA_vSl5Nq4c';
export const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';

// API do servidor da UFPA, relativa a pagina do app (o app e a API ficam no mesmo site).
export const UFPA_API_URL = 'api/';

const BACKEND_STORAGE_KEY = 'cardume_backend_mode';
const VALID_MODES = ['local', 'supabase', 'ufpa'];

export function resolveBackendMode() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('backend');
    if (VALID_MODES.includes(fromUrl)) {
      localStorage.setItem(BACKEND_STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    const saved = localStorage.getItem(BACKEND_STORAGE_KEY);
    if (VALID_MODES.includes(saved)) return saved;
  } catch (e) { /* storage indisponivel: usa o padrao */ }
  return DEFAULT_BACKEND_MODE;
}
