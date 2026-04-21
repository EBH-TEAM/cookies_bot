const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const speakeasy = require('speakeasy');

// Stealth প্লাগইন ব্যবহার করুন
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

// হোম রুট
app.get('/', (req, res) => {
    res.json({ 
        status: 'active', 
        message: 'Instagram Cookie Bot API is running',
        time: new Date().toISOString(),
        version: '2.0.0'
    });
});

// হেলথ চেক রুট
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// Backup Code থেকে TOTP জেনারেট করার ফাংশন
function backupCodeToSecret(backupCode) {
    let clean = backupCode.replace(/[\s\-]/g, '').toUpperCase();
    let secret = clean.substring(0, 16);
    while (secret.length < 16) secret += 'A';
    return secret;
}

function generateTOTP(secret) {
    try {
        return speakeasy.totp({ 
            secret: secret, 
            encoding: 'base32', 
            step: 30, 
            digits: 6 
        });
    } catch(e) {
        return null;
    }
}

// কুকি জেনারেট করার API
app.post('/get-cookie', async (req, res) => {
    const { username, password, twofa } = req.body;
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📥 New request received`);
    console.log(`👤 Username: ${username}`);
    console.log(`🔐 Password: ${password ? '****' : 'missing'}`);
    console.log(`🔑 2FA/Backup: ${twofa ? twofa.substring(0, 10) + '...' : 'none'}`);
    
    if (!username || !password) {
        return res.json({ 
            success: false, 
            error: 'Username and password are required' 
        });
    }
    
    let browser = null;
    let live2FACode = null;
    
    try {
        // 2FA ইনপুট প্রসেস করুন
        let cleanInput = twofa ? twofa.replace(/[\s\-]/g, '').toUpperCase() : '';
        
        if (cleanInput.length === 32 || cleanInput.length === 16) {
            // এটা Backup Code
            console.log(`🔄 Backup Code detected, converting to live TOTP...`);
            const secret = backupCodeToSecret(cleanInput);
            live2FACode = generateTOTP(secret);
            console.log(`✅ Generated 6-digit code: ${live2FACode}`);
        } 
        else if (cleanInput.length === 6 && /^\d+$/.test(cleanInput)) {
            // সরাসরি 6 ডিজিটের কোড
            live2FACode = cleanInput;
            console.log(`📱 Direct 6-digit code provided`);
        }
        
        // ব্রাউজার লঞ্চ করুন
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
        page.setDefaultTimeout(60000);
        
        console.log(`🌐 Navigating to Instagram...`);
        
        // প্রথমে Instagram হোম পেজে যান
        await page.goto('https://www.instagram.com/', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });
        
        await page.waitForTimeout(3000);
        
        // CSRF টোকেন সংগ্রহ করুন
        let cookies = await page.cookies();
        let csrfToken = '';
        for (const cookie of cookies) {
            if (cookie.name === 'csrftoken') {
                csrfToken = cookie.value;
                break;
            }
        }
        
        console.log(`🔑 CSRF Token: ${csrfToken.substring(0, 10)}...`);
        
        // API দিয়ে লগইন করুন
        console.log(`🔐 Attempting login for: ${username}`);
        
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
        
        console.log(`📡 Login API response:`, JSON.stringify(loginResult, null, 2));
        
        // লগইন সফল হলে
        if (loginResult.authenticated) {
            console.log(`✅ Login successful for: ${username}`);
            let finalCookies = await page.cookies();
            let cookieString = finalCookies.map(c => `${c.name}=${c.value}`).join('; ');
            
            await browser.close();
            return res.json({ 
                success: true, 
                cookie: cookieString,
                message: 'Cookie extracted successfully'
            });
        }
        
        // 2FA প্রয়োজন হলে
        if (loginResult.two_factor_required && live2FACode) {
            console.log(`🔐 2FA required, submitting code: ${live2FACode}`);
            
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
            }, username, live2FACode, csrfToken);
            
            console.log(`📡 2FA API response:`, JSON.stringify(twofaResult, null, 2));
            
            if (twofaResult.authenticated) {
                console.log(`✅ 2FA successful for: ${username}`);
                let finalCookies = await page.cookies();
                let cookieString = finalCookies.map(c => `${c.name}=${c.value}`).join('; ');
                
                await browser.close();
                return res.json({ 
                    success: true, 
                    cookie: cookieString,
                    message: 'Cookie extracted successfully with 2FA'
                });
            } else {
                console.log(`❌ 2FA failed for: ${username}`);
                await browser.close();
                return res.json({ 
                    success: false, 
                    error: '2FA verification failed - invalid code' 
                });
            }
        }
        
        if (loginResult.two_factor_required && !live2FACode) {
            console.log(`⚠️ 2FA required but no code provided`);
            await browser.close();
            return res.json({ 
                success: false, 
                error: '2FA required but no code provided. Please provide backup code or 6-digit code.' 
            });
        }
        
        // লগইন ব্যর্থ
        console.log(`❌ Login failed for: ${username}`);
        await browser.close();
        return res.json({ 
            success: false, 
            error: 'Login failed - invalid username or password' 
        });
        
    } catch (error) {
        console.error(`💥 Error for ${username}:`, error.message);
        if (browser) await browser.close();
        return res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// সার্ভার চালু করুন
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🚀 Instagram Cookie Bot Server`);
    console.log(`📡 Running on port: ${PORT}`);
    console.log(`🌐 API URL: http://localhost:${PORT}`);
    console.log(`✅ Status: Active`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});
