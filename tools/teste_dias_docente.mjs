// Teste de tela de Indicadores > Dias do docente (usa a tela como o usuario):
//  - a sub-aba aparece, mostra a escolha do docente e esconde a tabela de carga;
//  - passa por todos os docentes do ano e anota quantos dias carregados cada um tem;
//  - abre o docente com mais dias carregados e confere o quadro (linhas, colunas, vermelho);
//  - passar o mouse num dia carregado escreve "N componentes" (caixa no cabecalho do PL);
//  - foto da tela em <pasta temporaria>/dias_docente.png.
// Dados: alocacoes_publicas.json (o que esta publicado). Nada e gravado no projeto.
//
// Uso (na raiz do projeto):   node tools/teste_dias_docente.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep, startServer, findBrowser, openBrowser, cdp, loadPublishedData, seedScript } from './smoke_test.mjs';

const data = loadPublishedData();
const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-dias-'));
const { proc, ws } = await openBrowser(findBrowser(), profileDir);
const errors = [];
const { send, evaluate, waitFor } = cdp(ws, errors);

let falhas = 0;
const confere = (nome, ok, detalhe = '') => {
    if (!ok) falhas++;
    console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${nome}${detalhe ? ' - ' + detalhe : ''}`);
};

try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: seedScript(data) });
    await send('Page.navigate', { url: `${baseUrl}/index.html?backend=local` });
    await waitFor("document.querySelectorAll('#sel-curso option').length > 0", 15000);
    await sleep(1500);

    const ano = String(data.main.plan.termStart).slice(0, 4);
    console.log(`Ano: ${ano} (PL aberto: ${data.main.plan.periodo})`);
    await evaluate(`(async () => {
        document.getElementById('tabbtn-indicadores').click();
        await new Promise(r => setTimeout(r, 800));
        const sel = document.getElementById('sel-ano-indicadores');
        if (sel.value !== '${ano}') { sel.value = '${ano}'; sel.dispatchEvent(new Event('change')); }
        await new Promise(r => setTimeout(r, 1500));
        document.querySelector('.ind-subaba[data-subaba="dias"]').click();
        await new Promise(r => setTimeout(r, 500));
        return 'ok';
    })()`);
    // 28/11/2026: a sub-aba abre no PL do momento (um PL marcado, nao o Anual).
    const abriuNoPL = await evaluate(`!document.getElementById('btn-ano-inteiro-indicadores').classList.contains('is-active')
        && !!document.querySelector('#ind-pl-buttons .is-active')`);
    confere('Dia a dia do docente abre no PL do momento', abriuNoPL);
    // O resto do teste olha o ano inteiro: clica em Anual.
    await evaluate(`(async () => { document.getElementById('btn-ano-inteiro-indicadores').click(); await new Promise(r => setTimeout(r, 300)); return 'ok'; })()`);

    const telaVazia = JSON.parse(await evaluate(`JSON.stringify({
        caixa: !document.getElementById('ind-docente-box').classList.contains('hidden'),
        notaDias: !document.getElementById('ind-nota-dias').classList.contains('hidden'),
        notaCarga: document.getElementById('ind-nota-carga').classList.contains('hidden'),
        docentes: document.querySelectorAll('#list-view-docentes option').length,
        texto: document.getElementById('ind-tabela').textContent.trim()
    })`));
    confere('aparece a escolha do docente e a nota certa', telaVazia.caixa && telaVazia.notaDias && telaVazia.notaCarga);
    confere('lista de docentes preenchida', telaVazia.docentes > 0, `${telaVazia.docentes} docentes`);
    confere('sem docente: pede para escolher', /Digite o nome do docente/.test(telaVazia.texto));

    // Docente embaixo das sub-abas, ao lado da barra lateral (28/11/2026), e a lista de sugestoes ao digitar "eva".
    const caixa = JSON.parse(await evaluate(`(async () => {
        const inp = document.getElementById('inp-docente-dias');
        const lateral = document.querySelector('#tab-indicadores .ind-lateral').getBoundingClientRect();
        const abas = document.querySelector('#tab-indicadores .ind-subabas').getBoundingClientRect();
        const rot = document.querySelector('#ind-docente-box .ind-busca-rotulo').getBoundingClientRect();
        inp.focus();
        inp.value = 'eva';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        const itens = [...document.querySelectorAll('.sug-docente:not([hidden]) li')].map(li => li.textContent.trim());
        return JSON.stringify({ linha2: rot.top >= abas.bottom, alinhado: rot.left > lateral.right, itens });
    })()`));
    confere('Docente fica embaixo das sub-abas, ao lado da barra lateral', caixa.linha2 && caixa.alinhado);
    confere('digitar "eva" mostra sugestoes', caixa.itens.length > 0, caixa.itens.slice(0, 4).join(' | '));
    const fotoTopo = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1536, height: 420, scale: 1 } });
    fs.writeFileSync(path.join(os.tmpdir(), 'dias_docente_topo.png'), Buffer.from(fotoTopo.result.data, 'base64'));
    await evaluate(`(() => { const i = document.getElementById('inp-docente-dias'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); document.body.click(); return 'ok'; })()`);

    // Todos os docentes, um por um (tambem mede o tempo de desenhar).
    const ranking = JSON.parse(await evaluate(`(async () => {
        const sel = document.getElementById('inp-docente-dias');
        const nomes = [...document.querySelectorAll('#list-view-docentes option')].map(o => o.value).filter(Boolean);
        const out = [];
        let pior = 0;
        for (const nome of nomes) {
            const t0 = performance.now();
            sel.value = nome; sel.dispatchEvent(new Event('change'));
            pior = Math.max(pior, performance.now() - t0);
            const m = document.getElementById('ind-resumo').textContent.match(/(\\d+) dias? com sobrecarga/);
            out.push([nome, m ? Number(m[1]) : 0]);
        }
        out.sort((a, b) => b[1] - a[1]);
        return JSON.stringify({ out, pior: Math.round(pior) });
    })()`));
    const comCarga = ranking.out.filter(([, n]) => n > 0);
    console.log(`Docentes com dias carregados no ano: ${comCarga.length} de ${ranking.out.length}; desenho mais lento: ${ranking.pior} ms`);
    comCarga.slice(0, 8).forEach(([nome, n]) => console.log(`   ${String(n).padStart(3)}  ${nome}`));
    confere('desenhar um docente leva menos de 1,5 s', ranking.pior < 1500, `${ranking.pior} ms`);

    const alvo = (comCarga[0] || ranking.out[0])[0];
    const quadro = JSON.parse(await evaluate(`(async () => {
        const sel = document.getElementById('inp-docente-dias');
        // Digita so um pedaco, sem acento e minusculo: o Cardume completa o nome.
        sel.value = ${JSON.stringify(alvo.split(' ')[0].toLowerCase())}; sel.dispatchEvent(new Event('change'));
        const completou = sel.value;
        await new Promise(r => setTimeout(r, 300));
        // O quadro (PL) que tem dia vermelho; sem nenhum, o primeiro.
        const q = document.querySelector('.dd-d.dd-n2')?.closest('.dd-quadro') || document.querySelector('.dd-quadro[data-dd-quadro]');
        if (!q) return JSON.stringify({ erro: 'sem quadro' });
        const vermelho = q.querySelector('.dd-d.dd-n2');
        let info = '';
        if (vermelho) {
            vermelho.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            info = q.querySelector('.dd-info').textContent;
        }
        const grade = q.querySelector('.dd-grade');
        const cel = q.querySelector('.dd-d.dd-on') || q.querySelector('.dd-d');
        const r = cel.getBoundingClientRect();
        return JSON.stringify({
            quadros: document.querySelectorAll('.dd-quadro').length,
            componentes: q.querySelectorAll('.dd-rot-nome').length - 1,
            dias: q.querySelectorAll('.dd-d.dd-resumo').length,
            vermelhos: q.querySelectorAll('.dd-d.dd-n2').length,
            info,
            focados: q.querySelectorAll('.is-foco').length,
            larguraGrade: Math.round(grade.getBoundingClientRect().width),
            paginaRolaParaOLado: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            rolaParaOLado: [...document.querySelectorAll('.dd-rolagem')].map(e => e.scrollWidth - e.clientWidth).join(','),
            completou,
            resumo: document.getElementById('ind-resumo').textContent.replace(/\\s+/g, ' ').trim(),
            chPL: [...document.querySelectorAll('.dd-quadro .dd-ch')].map(e => e.textContent).join(','),
            celula: Math.round(r.width * 10) / 10 + ' x ' + Math.round(r.height)
        });
    })()`));
    console.log('Quadro de', alvo, quadro);
    confere('carga horaria do ano e de cada PL no resumo', /\d+h no ano \(PL1 \d+h/.test(quadro.resumo), quadro.resumo + ' | por PL: ' + quadro.chPL);
    confere('quadro desenhado com componentes', !quadro.erro && quadro.componentes > 0);
    confere('digitar so o primeiro nome, minusculo, completa o nome', quadro.completou === alvo, quadro.completou);
    confere('em tela de 1536 px nenhum PL rola para o lado', String(quadro.rolaParaOLado).split(',').every((n) => Number(n) <= 0), `sobra por PL: ${quadro.rolaParaOLado}`);
    if (comCarga.length) {
        confere('dia vermelho mostra "N componentes"', /[0-9] componentes/.test(quadro.info), quadro.info.slice(0, 160));
        confere('passar o mouse acende a coluna', quadro.focados >= 3, `${quadro.focados} elementos`);
    }

    // Fecha a lista de sugestoes (o teste escreve o nome sem clicar nela).
    await evaluate(`document.querySelectorAll('.sug-docente').forEach(l => { l.hidden = true; }); 'ok'`);
    // Foto do quadro que tem dia vermelho (ou do primeiro).
    const clip = JSON.parse(await evaluate(`(() => {
        const q = document.querySelector('.dd-d.dd-n2')?.closest('.dd-quadro') || document.querySelector('.dd-quadro');
        q.scrollIntoView({ block: 'start' });
        const r = q.getBoundingClientRect();
        return JSON.stringify({ x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height });
    })()`));
    await sleep(300);
    const foto = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
    const arquivo = path.join(os.tmpdir(), 'dias_docente.png');
    fs.writeFileSync(arquivo, Buffer.from(foto.result.data, 'base64'));
    console.log('Foto:', arquivo);
    confere('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
    falhas++;
    console.error('ERRO:', err);
} finally {
    try { proc.kill(); } catch {}
    server.close();
}
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo OK');
process.exit(falhas ? 1 : 0);
