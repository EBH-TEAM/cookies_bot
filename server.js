const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Stealth প্লাগইন ব্যবহার করুন (Instagram ডিটেকশন এভয়েড)
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

// হোম রুট - চেক করার জন্য
app.get('/', (req, res) => {
    res.json({ 
        status: 'active', 
        message: 'Cookie Bot API is running',
        time: new Date().toISOString()
    });
});

// কুকি জেনারেট করার এন্ডপয়েন্ট
app.post('/get-cookie', async (req, res) => {
    const { username, password, twofa } = req.body;
    
    console.log(`📥 Request received for: ${username}`);
    
    if (!username || !password) {
        return res.json({ success: false, error: 'username and password required' });
    }
    
    let browser = null;
    
    try {
        // ব্রাউজার লঞ্চ করুন
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
        
        // ভিউপোর্ট সেট করুন
        await page.setViewport({ width: 1280, height: 720 });
        
        // টাইমআউট 60 সেকেন্ড
        page.setDefaultTimeout(60000);
        page.setDefaultNavigationTimeout(60000);
        
        console.log(`🌐 Navigating to Instagram login page...`);
        
        // Instagram লগইন পেজে যান
        await page.goto('https://www.instagram.com/accounts/login/', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });
        
        // পেজ লোডের জন্য অপেক্ষা
        await page.waitForTimeout(3000);
        
        // একাধিক সিলেক্টর চেষ্টা করুন
        let loginFormFound = false;
        const selectors = [
            'input[name="username"]',
            'input[aria-label*="username" i]',
            'input[aria-label*="Phone number" i]',
            'input[type="text"]'
        ];
        
        for (const selector of selectors) {
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                loginFormFound = true;
                console.log(`✅ Found selector: ${selector}`);
                break;
            } catch(e) {
                console.log(`❌ Selector ${selector} not found`);
            }
        }
        
        if (!loginFormFound) {
            // ডিবাগের জন্য স্ক্রিনশট
            await page.screenshot({ path: '/tmp/debug_login.png' });
            throw new Error('Login form not found - Instagram layout may have changed');
        }
        
        // ইউজারনেম টাইপ করুন
        await page.waitForSelector('input[name="username"]', { timeout: 10000 });
        await page.click('input[name="username"]', { clickCount: 3 });
        await page.type('input[name="username"]', username, { delay: 50 });
        
        // পাসওয়ার্ড টাইপ করুন
        await page.type('input[name="password"]', password, { delay: 50 });
        
        // লগইন বাটনে ক্লিক করুন
        await page.click('button[type="submit"]');
        
        console.log(`🔐 Login submitted for: ${username}`);
        
        // লগইন প্রসেসের জন্য অপেক্ষা
        await page.waitForTimeout(8000);
        
        // বর্তমান URL চেক করুন
        const currentUrl = page.url();
        console.log(`📍 Current URL: ${currentUrl}`);
        
        // কুকি নিন
        let cookies = await page.cookies();
        let cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        
        // 2FA চেক করুন
        if (currentUrl.includes('challenge') || currentUrl.includes('two_factor') || currentUrl.includes('login_attempt')) {
            console.log(`🔐 2FA detected for: ${username}`);
            
            if (twofa && twofa.trim().length > 0) {
                try {
                    await page.waitForTimeout(3000);
                    
                    // 2FA ইনপুট ফিল্ড খুঁজুন
                    const twofaSelectors = [
                        'input[name="verificationCode"]',
                        'input[type="text"][inputmode="numeric"]',
                        'input[aria-label*="code" i]'
                    ];
                    
                    let twofaInputFound = false;
                    for (const selector of twofaSelectors) {
                        try {
                            await page.waitForSelector(selector, { timeout: 5000 });
                            twofaInputFound = true;
                            await page.type(selector, twofa, { delay: 50 });
                            console.log(`✅ 2FA code entered`);
                            break;
                        } catch(e) {}
                    }
                    
                    if (!twofaInputFound) {
                        throw new Error('2FA input field not found');
                    }
                    
                    // Submit বাটনে ক্লিক করুন
                    await page.waitForTimeout(1000);
                    const submitBtn = await page.$('button[type="button"]');
                    if (submitBtn) {
                        await submitBtn.click();
                    } else {
                        await page.click('button[type="submit"]');
                    }
                    
                    await page.waitForTimeout(8000);
                    
                    // নতুন কুকি নিন
                    cookies = await page.cookies();
                    cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                    
                } catch(e) {
                    await browser.close();
                    return res.json({ success: false, error: `2FA failed: ${e.message}` });
                }
            } else {
                await browser.close();
                return res.json({ success: false, error: '2FA required but no code provided' });
            }
        }
        
        // সেশন চেক করুন
        const hasSession = cookies.some(c => c.name === 'sessionid') || cookieString.includes('sessionid');
        
        if (hasSession) {
            console.log(`✅ Successfully got cookie for: ${username}`);
            await browser.close();
            return res.json({ success: true, cookie: cookieString });
        } else {
            console.log(`❌ Login failed for: ${username}`);
            await browser.close();
            return res.json({ success: false, error: 'Login failed - invalid credentials or Instagram blocked' });
        }
        
    } catch (error) {
        if (browser) await browser.close();
        console.error(`❌ Error for ${username}:`, error.message);
        return res.json({ success: false, error: error.message });
    }
});

// পোর্ট সেটআপ
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Cookie bot server running on port ${PORT}`);
    console.log(`📍 API URL: http://localhost:${PORT}`);
});
