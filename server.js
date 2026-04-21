const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: 'active', message: 'Cookie Bot API is running' });
});

app.post('/get-cookie', async (req, res) => {
    const { username, password, twofa } = req.body;
    
    if (!username || !password) {
        return res.json({ success: false, error: 'username and password required' });
    }
    
    let browser = null;
    
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        });
        
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.goto('https://www.instagram.com/accounts/login/', { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });
        
        await page.waitForSelector('input[name="username"]', { timeout: 10000 });
        
        await page.type('input[name="username"]', username, { delay: 100 });
        await page.type('input[name="password"]', password, { delay: 100 });
        
        await page.click('button[type="submit"]');
        
        await page.waitForTimeout(5000);
        
        const currentUrl = page.url();
        
        let cookies = await page.cookies();
        let cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        
        if (currentUrl.includes('challenge') || currentUrl.includes('two_factor')) {
            if (twofa) {
                const twofaInput = await page.$('input[name="verificationCode"]');
                if (twofaInput) {
                    await page.type('input[name="verificationCode"]', twofa, { delay: 100 });
                    await page.click('button[type="button"]');
                    await page.waitForTimeout(5000);
                    cookies = await page.cookies();
                    cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                } else {
                    return res.json({ success: false, error: '2FA required but no input field found' });
                }
            } else {
                return res.json({ success: false, error: '2FA required but no code provided' });
            }
        }
        
        const hasSession = cookies.some(c => c.name === 'sessionid');
        
        if (hasSession || cookieString.includes('sessionid')) {
            await browser.close();
            return res.json({ success: true, cookie: cookieString });
        } else {
            await browser.close();
            return res.json({ success: false, error: 'Login failed - invalid credentials' });
        }
        
    } catch (error) {
        if (browser) await browser.close();
        console.error('Cookie generation error:', error);
        return res.json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Cookie bot server running on port ${PORT}`);
});
