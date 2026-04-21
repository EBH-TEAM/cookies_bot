const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const speakeasy = require('speakeasy');

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: 'active', message: 'Cookie Bot API is running' });
});

function backupCodeToSecret(backupCode) {
    let clean = backupCode.replace(/[\s\-]/g, '').toUpperCase();
    let secret = clean.substring(0, 16);
    while (secret.length < 16) secret += 'A';
    return secret;
}

function generateTOTP(secret) {
    try {
        return speakeasy.totp({ secret: secret, encoding: 'base32', step: 30, digits: 6 });
    } catch(e) {
        return null;
    }
}

app.post('/get-cookie', async (req, res) => {
    const { username, password, twofa } = req.body;
    
    console.log(`📥 Request for: ${username}`);
    
    if (!username || !password) {
        return res.json({ success: false, error: 'username and password required' });
    }
    
    let browser = null;
    let live2FACode = null;
    
    try {
        // 2FA কোড প্রসেস
        let cleanTwofa = twofa ? twofa.replace(/[\s\-]/g, '').toUpperCase() : '';
        if (cleanTwofa.length === 32 || cleanTwofa.length === 16) {
            const secret = backupCodeToSecret(cleanTwofa);
            live2FACode = generateTOTP(secret);
            console.log(`Generated TOTP: ${live2FACode}`);
        } else if (cleanTwofa.length === 6 && /^\d+$/.test(cleanTwofa)) {
            live2FACode = cleanTwofa;
        } else {
            live2FACode = cleanTwofa;
        }
        
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1920,1080'
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        page.setDefaultTimeout(90000);
        
        // 🔥 নতুন পদ্ধতি - সরাসরি login page এ POST request
        console.log(`🌐 Logging in with new method...`);
        
        // প্রথমে main page এ যান
        await page.goto('https://www.instagram.com/', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });
        
        await page.waitForTimeout(3000);
        
        // এপিকে লগইন URL
        const loginUrl = 'https://www.instagram.com/api/v1/web/accounts/login/ajax/';
        
        // CSRF টোকেন নিন
        const cookies = await page.cookies();
        let csrfToken = '';
        for (const cookie of cookies) {
            if (cookie.name === 'csrftoken') {
                csrfToken = cookie.value;
                break;
            }
        }
        
        console.log(`CSRF Token: ${csrfToken}`);
        
        // এপিকে দিয়ে লগইন রিকোয়েস্ট
        const loginResponse = await page.evaluate(async (url, user, pass, csrf) => {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRFToken': csrf,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: `username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`
            });
            return await response.json();
        }, loginUrl, username, password, csrfToken);
        
        console.log(`Login response:`, loginResponse);
        
        if (loginResponse.authenticated) {
            // লগইন সফল
            let finalCookies = await page.cookies();
            let cookieString = finalCookies.map(c => `${c.name}=${c.value}`).join('; ');
            
            await browser.close();
            return res.json({ success: true, cookie: cookieString });
        }
        
        // 2FA প্রয়োজন হলে
        if (loginResponse.two_factor_required || loginResponse.checkpoint_required) {
            console.log(`🔐 2FA required`);
            
            if (live2FACode) {
                // 2FA ভেরিফাই
                const twofaUrl = 'https://www.instagram.com/api/v1/web/accounts/login/ajax/two_factor/';
                const twofaResponse = await page.evaluate(async (url, user, code, csrf) => {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'X-CSRFToken': csrf,
                            'X-Requested-With': 'XMLHttpRequest'
                        },
                        body: `username=${encodeURIComponent(user)}&verificationCode=${code}`
                    });
                    return await response.json();
                }, twofaUrl, username, live2FACode, csrfToken);
                
                console.log(`2FA response:`, twofaResponse);
                
                if (twofaResponse.authenticated) {
                    let finalCookies = await page.cookies();
                    let cookieString = finalCookies.map(c => `${c.name}=${c.value}`).join('; ');
                    
                    await browser.close();
                    return res.json({ success: true, cookie: cookieString });
                } else {
                    await browser.close();
                    return res.json({ success: false, error: '2FA verification failed' });
                }
            } else {
                await browser.close();
                return res.json({ success: false, error: '2FA required but no code provided' });
            }
        }
        
        await browser.close();
        return res.json({ success: false, error: 'Login failed - invalid credentials' });
        
    } catch (error) {
        if (browser) await browser.close();
        console.error(`❌ Error:`, error.message);
        return res.json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
