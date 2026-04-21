const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const speakeasy = require('speakeasy');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

// TOTP Generator Function
function generateTOTP(secret) {
    try {
        let cleanSecret = secret.replace(/[\s\-]/g, '').toUpperCase();
        return speakeasy.totp({ 
            secret: cleanSecret, 
            encoding: 'base32'
        });
    } catch(e) { return null; }
}

app.post('/get-cookie', async (req, res) => {
    const { username, password, twofa } = req.body;
    let browser = null;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log(`Attempting login: ${username}`);
        await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle2', timeout: 60000 });

        // ইউজারনেম ও পাসওয়ার্ড ফিল্ডের জন্য অপেক্ষা
        await page.waitForSelector('input[name="username"]', { timeout: 10000 });
        await page.type('input[name="username"]', username, { delay: 100 });
        await page.type('input[name="password"]', password, { delay: 100 });
        
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
        ]);

        // ২এফএ (2FA) চেক
        if (page.url().includes('two_factor') || await page.$('input[name="verificationCode"]')) {
            console.log("2FA Challenge detected...");
            const code = generateTOTP(twofa);
            if (!code) throw new Error("Invalid 2FA Secret Key");

            await page.waitForSelector('input[name="verificationCode"]');
            await page.type('input[name="verificationCode"]', code, { delay: 100 });
            
            await Promise.all([
                page.keyboard.press('Enter'),
                page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {})
            ]);
        }

        // লগইন সাকসেস হয়েছে কিনা চেক (কুকি চেক)
        const cookies = await page.cookies();
        const sessionid = cookies.find(c => c.name === 'sessionid');

        if (sessionid) {
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            console.log(`✅ Success: ${username}`);
            await browser.close();
            return res.json({ success: true, cookie: cookieString });
        } else {
            throw new Error("Login failed (Session ID not found). Account might be checkpointed.");
        }

    } catch (error) {
        console.log(`❌ Error: ${username} - ${error.message}`);
        if (browser) await browser.close();
        res.json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => res.json({ status: 'active' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
