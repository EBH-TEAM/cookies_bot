const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const speakeasy = require('speakeasy');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

// TOTP কোড জেনারেট করার সঠিক ফাংশন
function generateTOTP(secret) {
    try {
        // স্পেস থাকলে মুছে ফেলে আপারকেস করা
        let cleanSecret = secret.replace(/\s/g, '').toUpperCase();
        return speakeasy.totp({
            secret: cleanSecret,
            encoding: 'base32'
        });
    } catch (e) {
        console.log("TOTP Error:", e.message);
        return null;
    }
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
                '--window-size=1920,1080'
            ]
        });

        const page = await browser.newPage();
        // রিয়েল ইউজারের মতো মনে হওয়ার জন্য ইউজার এজেন্ট
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log(`\n--- লগইন শুরু: ${username} ---`);
        await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle2', timeout: 60000 });
        
        // পেজ পুরোপুরি লোড হওয়ার জন্য একটু সময় দিন
        await new Promise(r => setTimeout(r, 4000));

        // ইউজারনেম ও পাসওয়ার্ড ইনপুট
        await page.waitForSelector('input[name="username"]');
        await page.type('input[name="username"]', username, { delay: 100 });
        await page.type('input[name="password"]', password, { delay: 100 });
        
        // লগইন বাটনে ক্লিক
        await page.click('button[type="submit"]');
        
        // রিডাইরেক্ট হওয়ার জন্য অপেক্ষা
        console.log("লগইন বাটন ক্লিক করা হয়েছে, অপেক্ষা করছি...");
        await new Promise(r => setTimeout(r, 8000));

        // ২এফএ (2FA) চেক
        if (page.url().includes('two_factor') || await page.$('input[name="verificationCode"]')) {
            console.log("২এফএ কোড প্রয়োজন...");
            const code = generateTOTP(twofa);
            
            if (!code) throw new Error("Invalid 2FA Secret Key");
            console.log(`জেনারেটেড কোড: ${code}`);

            await page.waitForSelector('input[name="verificationCode"]');
            await page.type('input[name="verificationCode"]', code, { delay: 100 });
            
            // এন্টার প্রেস করা
            await page.keyboard.press('Enter');
            await new Promise(r => setTimeout(r, 10000)); // সাকসেসফুল লগইন হওয়ার জন্য সময় দিন
        }

        // কুকি চেক করা
        const cookies = await page.cookies();
        const sessionid = cookies.find(c => c.name === 'sessionid');

        if (sessionid) {
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            console.log(`✅ ${username} - কুকি পাওয়া গেছে!`);
            await browser.close();
            return res.json({ success: true, cookie: cookieString });
        } else {
            // যদি সেশন আইডি না পাওয়া যায়, তার মানে একাউন্ট চেকপয়েন্টে আছে
            console.log(`❌ ${username} - সেশন আইডি পাওয়া যায়নি।`);
            throw new Error("Login failed. Possible Checkpoint or Wrong Info.");
        }

    } catch (error) {
        console.log(`💥 ভুল: ${error.message}`);
        if (browser) await browser.close();
        res.json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => res.json({ status: 'running' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`সার্ভার চলছে ${PORT} পোর্টে`));
