const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const speakeasy = require('speakeasy');
const crypto = require('crypto');

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: 'active', message: 'Cookie Bot API is running with TOTP support' });
});

// Backup Code থেকে TOTP Secret বের করার ফাংশন
function backupCodeToSecret(backupCode) {
    // স্পেস ও ড্যাশ রিমুভ
    let clean = backupCode.replace(/[\s\-]/g, '').toUpperCase();
    console.log(`Clean backup code: ${clean.substring(0, 8)}****`);
    
    // Base32 এ কনভার্ট (Instagram backup code format)
    // প্রথম 16 ডিজিট নিয়ে TOTP secret বানাই
    let secret = clean.substring(0, 16);
    
    // যদি 16 ডিজিট না থাকে, প্যাডিং যোগ করি
    while (secret.length < 16) {
        secret += 'A';
    }
    
    return secret;
}

// TOTP কোড জেনারেট করুন (30 সেকেন্ডে চেইঞ্জ হয়)
function generateTOTP(secret) {
    try {
        const token = speakeasy.totp({
            secret: secret,
            encoding: 'base32',
            step: 30,
            digits: 6
        });
        return token;
    } catch(e) {
        console.error('TOTP generate error:', e);
        return null;
    }
}

// Backup Code থেকে লাইভ 2FA কোড জেনারেট করুন
function getLive2FACode(backupCode) {
    const secret = backupCodeToSecret(backupCode);
    const totpCode = generateTOTP(secret);
    console.log(`Generated TOTP: ${totpCode} (valid for 30 seconds)`);
    return totpCode;
}

app.post('/get-cookie', async (req, res) => {
    const { username, password, twofa } = req.body;
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📥 Request for: ${username}`);
    console.log(`2FA/Backup provided: ${twofa ? twofa.substring(0, 8) + '...' : 'none'}`);
    
    if (!username || !password) {
        return res.json({ success: false, error: 'username and password required' });
    }
    
    let browser = null;
    let live2FACode = null;
    
    try {
        // চেক করুন twofa টি Backup Code নাকি সরাসরি 6 ডিজিট
        let cleanTwofa = twofa.replace(/[\s\-]/g, '').toUpperCase();
        
        if (cleanTwofa.length === 32 || cleanTwofa.length === 16) {
            // এটা Backup Code (16 বা 32 ডিজিট)
            console.log(`🔐 Backup Code detected, generating live TOTP...`);
            live2FACode = getLive2FACode(cleanTwofa);
            if (!live2FACode) {
                return res.json({ success: false, error: 'Failed to generate TOTP from backup code' });
            }
            console.log(`✅ Live 2FA Code generated: ${live2FACode}`);
        } else if (cleanTwofa.length === 6 && /^\d+$/.test(cleanTwofa)) {
            // এটা সরাসরি 6 ডিজিটের কোড
            live2FACode = cleanTwofa;
            console.log(`📱 Direct 6-digit code provided: ${live2FACode}`);
        } else {
            live2FACode = cleanTwofa;
            console.log(`⚠️ Unknown format, using as-is: ${live2FACode}`);
        }
        
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
                '--disable-blink-features=AutomationControlled'
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        page.setDefaultTimeout(60000);
        page.setDefaultNavigationTimeout(60000);
        
        console.log(`🌐 Navigating to Instagram login...`);
        
        await page.goto('https://www.instagram.com/accounts/login/', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });
        
        await page.waitForTimeout(5000);
        
        // ইউজারনেম ও পাসওয়ার্ড
        await page.waitForSelector('input[name="username"]', { timeout: 15000 });
        await page.type('input[name="username"]', username, { delay: 80 });
        await page.type('input[name="password"]', password, { delay: 80 });
        
        await page.click('button[type="submit"]');
        await page.waitForTimeout(8000);
        
        let currentUrl = page.url();
        console.log(`📍 After login URL: ${currentUrl}`);
        
        // 2FA চেক
        if (currentUrl.includes('challenge') || currentUrl.includes('two_factor')) {
            console.log(`🔐 2FA screen detected`);
            
            if (live2FACode) {
                await page.waitForTimeout(3000);
                
                // 2FA কোড ইনপুট
                const codeSelectors = [
                    'input[name="verificationCode"]',
                    'input[type="text"][inputmode="numeric"]',
                    'input[aria-label*="code" i]',
                    'input[aria-label*="verification" i]'
                ];
                
                let codeEntered = false;
                for (const selector of codeSelectors) {
                    try {
                        await page.waitForSelector(selector, { timeout: 5000 });
                        await page.click(selector, { clickCount: 3 });
                        await page.type(selector, live2FACode, { delay: 50 });
                        codeEntered = true;
                        console.log(`✅ 2FA code entered: ${live2FACode}`);
                        break;
                    } catch(e) {}
                }
                
                if (!codeEntered) {
                    throw new Error('Could not find 2FA input field');
                }
                
                await page.waitForTimeout(1000);
                
                // Submit
                try {
                    const submitBtn = await page.$('button[type="button"]');
                    if (submitBtn) await submitBtn.click();
                    else await page.click('button[type="submit"]');
                } catch(e) {
                    await page.keyboard.press('Enter');
                }
                
                await page.waitForTimeout(8000);
            } else {
                await browser.close();
                return res.json({ success: false, error: '2FA required but no code provided' });
            }
        }
        
        // ফাইনাল কুকি
        let cookies = await page.cookies();
        let cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        
        const hasSession = cookieString.includes('sessionid') || cookieString.includes('ds_user_id');
        
        if (hasSession) {
            console.log(`✅ SUCCESS! Cookie for ${username}`);
            await browser.close();
            return res.json({ success: true, cookie: cookieString });
        } else {
            console.log(`❌ FAILED for ${username}`);
            await browser.close();
            return res.json({ success: false, error: 'Login failed - invalid credentials or 2FA wrong' });
        }
        
    } catch (error) {
        if (browser) await browser.close();
        console.error(`❌ Error:`, error.message);
        return res.json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Cookie bot server running on port ${PORT}`);
    console.log(`✅ TOTP Generator Ready - Backup Code Support Active`);
});
