const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        
        page.on('console', msg => {
            if (msg.type() === 'error') console.log('PAGE ERROR STR:', msg.text());
        });
        
        page.on('pageerror', error => {
            console.log('UNCAUGHT PAGE ERROR:', error.message);
        });

        await page.goto('http://127.0.0.1:8081/index.html');
        await new Promise(r => setTimeout(r, 2000));
        await browser.close();
    } catch (e) {
        console.error(e);
    }
})();
