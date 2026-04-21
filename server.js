const express = require('express');
const puppeteer = require('puppeteer');

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
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-blink-features=AutomationControlled',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ]
        });
        
        const page = await browser.newPage();
        
        // ইউজার এজেন্ট সেট
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // ওয়েবড্রাইভার ডিটেকশন এভয়েড
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        
        // Instagram পেজে যান
        await page.goto('https://www.instagram.com/accounts/login/', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });
        
        // একটু অপেক্ষা করুন পেজ লোডের জন্য
        await page.waitForTimeout(3000);
        
        // সিলেক্টর এর জন্য অপেক্ষা
        await page.waitForSelector('input[name="username"]', { timeout: 15000 });
        
        // ইউজারনেম টাইপ
        await page.type('input[name="username"]', username, { delay: 100 });
        await page.type('input[name="password"]', password, { delay: 100 });
        
        // লগইন বাটনে ক্লিক
        await page.click('button[type="submit"]');
        
        // লগইন প্রসেসের জন্য অপেক্ষা
        await page.waitForTimeout(8000);
        
        // চেক করুন লগইন সফল হয়েছে কিনা
        const currentUrl = page.url();
        console.log('Current URL:', currentUrl);
        
        let cookies = await page.cookies();
        let cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        
        // 2FA চেক
        if (currentUrl.includes('challenge') || currentUrl.includes('two_factor')) {
            if (twofa) {
                await page.waitForTimeout(3000);
                const twofaInput = await page.$('input[name="verificationCode"]');
                if (twofaInput) {
                    await page.type('input[name="verificationCode"]', twofa, { delay: 100 });
                    await page.click('button[type="button"]');
                    await page.waitForTimeout(8000);
                    cookies = await page.cookies();
                    cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                } else {
                    await browser.close();
                    return res.json({ success: false, error: '2FA required but no input field found' });
                }
            } else {
                await browser.close();
                return res.json({ success: false, error: '2FA required but no code provided' });
            }
        }
        
        // সেশন চেক
        const hasSession = cookies.some(c => c.name === 'sessionid') || cookieString.includes('sessionid');
        
        if (hasSession) {
            await browser.close();
            return res.json({ success: true, cookie: cookieString });
        } else {
            await browser.close();
            return res.json({ success: false, error: 'Login failed - invalid credentials or Instagram blocked' });
        }
        
    } catch (error) {
        if (browser) await browser.close();
        console.error('Cookie generation error:', error);
        return res.json({ success: false, error: error.message });
    }
});

// টাইমআউট হেল্পার
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Cookie bot server running on port ${PORT}`);
});
