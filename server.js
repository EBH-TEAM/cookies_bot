const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const speakeasy = require('speakeasy');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: 'active', message: 'Server running' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// 2FA generate
function generateTOTP(secret) {
    try {
        return speakeasy.totp({
            secret: secret,
            encoding: 'base32'
        });
    } catch {
        return null;
    }
}

app.post('/get-cookie', async (req, res) => {
    const { username, password, twofa } = req.body;

    if (!username || !password) {
        return res.json({ success: false, error: "Missing data" });
    }

    let browser;

    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        const page = await browser.newPage();

        await page.goto('https://www.instagram.com/accounts/login/', {
            waitUntil: 'networkidle2'
        });

        await page.waitForSelector('input[name="username"]');

        await page.type('input[name="username"]', username, { delay: 50 });
        await page.type('input[name="password"]', password, { delay: 50 });

        await page.click('button[type="submit"]');

        await page.waitForTimeout(5000);

        // 2FA check
        if (twofa) {
            try {
                await page.waitForSelector('input[name="verificationCode"]', { timeout: 5000 });

                let code = twofa.length === 6 ? twofa : generateTOTP(twofa);

                await page.type('input[name="verificationCode"]', code);
                await page.click('button');

                await page.waitForTimeout(5000);
            } catch {}
        }

        // login success check
        const cookies = await page.cookies();

        if (!cookies.length) {
            await browser.close();
            return res.json({ success: false, error: "Login failed / blocked" });
        }

        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        await browser.close();

        return res.json({
            success: true,
            cookie: cookieString
        });

    } catch (err) {
        if (browser) await browser.close();

        return res.json({
            success: false,
            error: err.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Server running on port", PORT);
});
