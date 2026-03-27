const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const PORT = 5582;
const BASE_DIR = 'd:/Git/planejador-academico/gestor-iecos';

const logFile = path.join(__dirname, 'out_agenda.log');
fs.writeFileSync(logFile, '');
function logToFile(msg) { fs.appendFileSync(logFile, msg + '\n'); }

const server = http.createServer((req, res) => {
    let urlPath = req.url.split('?')[0];
    let filePath = path.join(BASE_DIR, urlPath === '/' ? 'agenda_publica.html' : urlPath);
    const extname = String(path.extname(filePath)).toLowerCase();
    
    const mimeTypes = {
        '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
        '.css': 'text/css', '.json': 'application/json'
    };

    fs.readFile(filePath, (error, content) => {
        if (error) {
            logToFile(`[FS ERROR] Could not read ${filePath}: ${error.code}`);
            res.writeHead(500); res.end('Error');
        } else {
            res.writeHead(200, { 'Content-Type': mimeTypes[extname] || 'application/octet-stream' });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, '127.0.0.1', async () => {
    logToFile(`Server running at http://127.0.0.1:${PORT}/`);
    try {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        page.on('console', msg => { if (msg.type() === 'error') logToFile('PAGE ERROR: ' + msg.text()); });
        page.on('pageerror', err => logToFile('UNCAUGHT: ' + err.message));

        await page.goto(`http://127.0.0.1:${PORT}/agenda_publica.html`, { waitUntil: 'load' });
        await new Promise(r => setTimeout(r, 2000));
        
        await page.evaluate(() => {
            const sel = document.getElementById('public-sel-curso');
            if (sel && sel.options.length > 1) {
                sel.value = sel.options[1].value;
                sel.dispatchEvent(new Event('change'));
            }
        });
        await new Promise(r => setTimeout(r, 1000));
        
        await page.evaluate(() => {
            const btnTurma = document.querySelector('#container-turmas button');
            if (btnTurma) btnTurma.click();
        });
        await new Promise(r => setTimeout(r, 1000));

        await page.evaluate(() => {
            const btnMes = document.querySelector('#container-meses-discente button');
            if (btnMes) btnMes.click();
        });
        await new Promise(r => setTimeout(r, 2000));

        const chips = await page.evaluate(() => document.querySelectorAll('.mini-chip').length);
        const days = await page.evaluate(() => document.querySelectorAll('.month-cal-day').length);
        
        logToFile('AFTER FULL SELECTION - CHIPS COUNT: ' + chips);
        logToFile('AFTER FULL SELECTION - DAYS RENDERED: ' + days);

        await browser.close();
        server.close();
        process.exit(0);
    } catch (e) {
        logToFile("Puppeteer Error: " + e.message);
        server.close();
        process.exit(1);
    }
});
