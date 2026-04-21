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
    
    console.log(`📥 Request for: ${username}`);
    
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
                '--disable-gpu',
                '--window-size=1920,1080'
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        page.setDefaultTimeout(90000);
        
        // 🔥 সরাসরি Instagram API ব্যবহার করুন - কোন selector লাগবে না!
        console.log(`🌐 Using Instagram API login...`);
        
        // প্রথমে home page এ যান (cookies পাওয়ার জন্য)
        await page.goto('https://www.instagram.com/', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });
        
        await page.waitForTimeout(3000);
        
        // CSRF টোকেন নিন
        let cookies = await page.cookies();
        let csrfToken = '';
        for (const cookie of cookies) {
            if (cookie.name === 'csrftoken') {
                csrfToken = cookie.value;
                break;
            }
        }
        
        console.log(`CSRF Token: ${csrfToken}`);
        
        // API দিয়ে লগইন করুন
        const loginResult = await page.evaluate(async (user, pass, csrf) => {
            const response = await fetch('https://www.instagram.com/api/v1/web/accounts/login/ajax/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRFToken': csrf,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: `username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`
            });
            return await response.json();
        }, username, password, csrfToken);
        
        console.log(`Login result:`, loginResult);
        
        if (loginResult.authenticated) {
            // লগইন সফল
            let finalCookies = await page.cookies();
            let cookieString = finalCookies.map(c => `${c.name}=${c.value}`).join('; ');
            
            await browser.close();
            return res.json({ success: true, cookie: cookieString });
        }
        
        // 2FA প্রয়োজন হলে
        if (loginResult.two_factor_required && twofa) {
            console.log(`🔐 2FA required, using code: ${twofa}`);
            
            const twofaResult = await page.evaluate(async (user, code, csrf) => {
                const response = await fetch('https://www.instagram.com/api/v1/web/accounts/login/ajax/two_factor/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-CSRFToken': csrf,
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: `username=${encodeURIComponent(user)}&verificationCode=${code}`
                });
                return await response.json();
            }, username, twofa, csrfToken);
            
            console.log(`2FA result:`, twofaResult);
            
            if (twofaResult.authenticated) {
                let finalCookies = await page.cookies();
                let cookieString = finalCookies.map(c => `${c.name}=${c.value}`).join('; ');
                
                await browser.close();
                return res.json({ success: true, cookie: cookieString });
            } else {
                await browser.close();
                return res.json({ success: false, error: '2FA verification failed' });
            }
        }
        
        if (loginResult.two_factor_required && !twofa) {
            await browser.close();
            return res.json({ success: false, error: '2FA required but no code provided' });
        }
        
        await browser.close();
        return res.json({ success: false, error: 'Login failed - invalid username or password' });
        
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
