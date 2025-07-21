const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
const readline = require('readline');

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

const logger = {
    info: (message) => console.log(`${colors.blue}[INFO]${colors.reset} ${message}`),
    warn: (message) => console.warn(`${colors.yellow}[PERINGATAN]${colors.reset} ${message}`),
    error: (message) => console.error(`${colors.red}[ERROR]${colors.reset} ${message}`),
    success: (message) => console.log(`${colors.green}[SUKSES]${colors.reset} ${message}`),
    printTable: (headers, rows) => {
        const columnWidths = headers.map((header, i) =>
            Math.max(header.length, ...rows.map(row => (row[i] || '').toString().length))
        );

        const headerLine = headers.map((header, i) =>
            header.padEnd(columnWidths[i])
        ).join(' | ');

        console.log(headerLine);
        console.log('-'.repeat(headerLine.length));

        rows.forEach(row => {
            const rowLine = row.map((cell, i) =>
                (cell || '').toString().padEnd(columnWidths[i])
            ).join(' | ');
            console.log(rowLine);
        });
    },
    clearLine: () => {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
    },
    printBanner: (banner) => {
        console.log(banner);
    }
};

const proxyManager = {
    proxies: {},
    enableProxy: false,
    
    async initialize() {},

    getProxyAgent(email) {
        if (!this.enableProxy) {
            return null;
        }
        const proxyUrl = this.proxies[email];
        if (!proxyUrl) {
            return null;
        }
        logger.warn(`Proxy untuk ${email} terdeteksi: ${proxyUrl}. Pastikan Anda memiliki modul agen proxy yang terinstal.`);
        return proxyUrl;
    }
};

class AutoSpinBot {
    constructor() {
        this.API_BASE_URL = 'https://api-iowa.shaga.xyz';
        this.accounts = [];
        this.countdowns = {};
        this.enableProxy = false;
        this.checkInterval = 3600;

        this.bannerText = `
=====================================
 GLOB Auto Spin Bot
 Dibuat oleh: @0xjiushi21 (Twitter)
              @zclsx (GitHub)
=====================================
        `;

        this.QUEST_ID = '6bb26924-e6ee-473f-8ad0-5e743c3f3e1f'; 
    }

    async initialize() {
        try {
            this._checkAndCreateDataFiles();
            
            this.enableProxy = await this._askForProxyUsage();
            proxyManager.enableProxy = this.enableProxy;

            if (this.enableProxy) {
                proxyManager.proxies = this._loadProxies();
                if (Object.keys(proxyManager.proxies).length === 0) {
                    logger.warn('Proxy diaktifkan, tetapi tidak ada konfigurasi proxy yang ditemukan di data/proxy.txt.');
                } else {
                    logger.info(`Memuat ${Object.keys(proxyManager.proxies).length} konfigurasi proxy.`);
                }
            }

            const tokensPath = path.join(process.cwd(), 'data', 'tokens.txt');
            const tokens = fs.readFileSync(tokensPath, 'utf8')
                .split('\n')
                .filter(token => token.trim() !== '' && !token.trim().startsWith('#'));

            for (const token of tokens) {
                try {
                    const tokenPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
                    this.accounts.push({
                        token: token.trim(),
                        uid: tokenPayload.sub,
                        email: tokenPayload.email
                    });
                } catch (error) {
                    logger.error(`Gagal mengurai token: ${error.message}`);
                }
            }

            logger.success(`Bot berhasil diinisialisasi, ${this.accounts.length} akun dimuat`);
            this.displayAccountsTable();
        } catch (error) {
            logger.error(`Gagal menginisialisasi Bot: ${error.message}`);
            process.exit(1);
        }
    }

    displayAccountsTable() {
        const headers = ['No.', 'Email', 'ID Pengguna', 'Status Proxy'];
        const rows = this.accounts.map((account, index) => {
            const hasProxy = proxyManager.getProxyAgent(account.email) ? 'Dikonfigurasi' : 'Tidak Dikonfigurasi';
            const maskedEmail = this._maskEmail(account.email);
            const maskedUid = this._maskUid(account.uid);
            
            return [
                (index + 1).toString(),
                maskedEmail,
                maskedUid,
                hasProxy
            ];
        });

        logger.printTable(headers, rows);
    }

    _maskEmail(email) {
        const atIndex = email.indexOf('@');
        if (atIndex <= 3) return email;
        
        const prefix = email.substring(0, 3);
        const suffix = email.substring(atIndex);
        return prefix + '***' + suffix;
    }

    _maskUid(uid) {
        if (!uid || uid.length <= 10) return uid;
        return uid.substring(0, 6) + '...' + uid.substring(uid.length - 4);
    }

    async performSpin(account) {
        try {
            const proxyAgentUrl = proxyManager.getProxyAgent(account.email);
            const axiosConfig = {
                headers: {
                    'authorization': `Bearer ${account.token}`,
                    'accept': 'application/json, text/plain, */*',
                    'content-type': 'application/json; charset=utf-8',
                    'origin': 'https://glob.shaga.xyz',
                    'referer': 'https://glob.shaga.xyz/'
                }
            };
            
            if (proxyAgentUrl) {
                logger.warn(`Menggunakan proxy: ${proxyAgentUrl} untuk akun ${this._maskEmail(account.email)}. Pastikan modul agen proxy terinstal.`);
                // Contoh: Anda perlu menginstal 'https-proxy-agent'
                // const { HttpsProxyAgent } = require('https-proxy-agent');
                // axiosConfig.httpsAgent = new HttpsProxyAgent(proxyAgentUrl);
            }
            
            const response = await axios.post(
                `${this.API_BASE_URL}/quests/${this.QUEST_ID}`,
                {}, 
                axiosConfig
            );
            return response.data;
        } catch (error) {
            if (error.response && error.response.data) {
                const responseData = error.response.data;
                // Respons Cooldown period not over yet
                if (responseData.message === "Cooldown period not over yet") {
                    logger.warn(`Akun ${this._maskEmail(account.email)}: ${responseData.message}`);
                    return {
                        message: responseData.message,
                        nextSpinDurationMs: responseData.nextSpinDurationMs 
                    };
                }
                // Tangani error umum lainnya dari server
                logger.error(`Akun ${this._maskEmail(account.email)} Spin gagal dengan respons server: ${JSON.stringify(responseData)}`);
                return responseData;
            } 
            // Tangani error jaringan atau lainnya
            logger.error(`Gagal melakukan Spin untuk akun ${this._maskEmail(account.email)}: ${error.message}`);
            return null;
        }
    }

    formatTimeRemaining(ms) {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((ms % (1000 * 60)) / 1000);
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    async checkAndSpin(account) {
        logger.info(`Akun ${this._maskEmail(account.email)} sedang mencoba melakukan Spin...`);
        const spinResult = await this.performSpin(account);
        
        if (spinResult) {
            // Kasus 1: Cooldown
            if (spinResult.message === "Cooldown period not over yet") {
                const duration = spinResult.nextSpinDurationMs || (4 * 60 * 60 * 1000); 
                this.startCountdown(account, duration);
            } 
            // Kasus 2: Spin berhasil dan mendapatkan poin (misal {"result": 400})
            else if (typeof spinResult.result === 'number' && spinResult.result >= 0) {
                logger.success(`Akun ${this._maskEmail(account.email)} Spin berhasil! Mendapatkan ${spinResult.result} poin.`);
                // Setelah spin berhasil, asumsikan perlu cooldown lagi (misal 4 jam)
                this.startCountdown(account, 4 * 60 * 60 * 1000); 
            } 
            // Kasus 3: Spin berhasil dengan hadiah lain (jika ada `rewards` properti)
            else if (spinResult.rewards) {
                logger.success(`Akun ${this._maskEmail(account.email)} Spin berhasil!`);
                logger.info(`Akun ${this._maskEmail(account.email)} mendapatkan hadiah: ${JSON.stringify(spinResult.rewards)}`);
                this.startCountdown(account, 4 * 60 * 60 * 1000); 
            }
            // Kasus 4: Respons tak terduga
            else {
                logger.error(`Akun ${this._maskEmail(account.email)} Spin gagal atau respons tidak terduga: ${JSON.stringify(spinResult)}`);
            }
        } else {
            logger.error(`Akun ${this._maskEmail(account.email)} Spin gagal tanpa respons yang jelas.`);
        }
    }

    startCountdown(account, duration) {
        if (this.countdowns[account.uid]) {
            const existingIntervalId = this.countdowns[account.uid].intervalId;
            const existingRemaining = this.countdowns[account.uid].remaining;
            
            if (duration < existingRemaining) {
                 clearInterval(existingIntervalId);
                 logger.info(`Memperbarui hitung mundur akun ${this._maskEmail(account.email)} dari ${this.formatTimeRemaining(existingRemaining)} menjadi ${this.formatTimeRemaining(duration)}.`);
                 this._setupCountdownInterval(account, duration);
            } else {
                 return;
            }
        } else {
            this._setupCountdownInterval(account, duration);
        }
    }

    _setupCountdownInterval(account, duration) {
        let remainingDuration = duration;
        const intervalId = setInterval(() => {
            logger.clearLine();
            process.stdout.write(
                `Akun ${this._maskEmail(account.email)} Hitung mundur Spin berikutnya: ${this.formatTimeRemaining(remainingDuration)}`
            );
            
            remainingDuration -= 1000; 
            if (remainingDuration <= 0) {
                clearInterval(intervalId);
                delete this.countdowns[account.uid];
                logger.info(`\nAkun ${this._maskEmail(account.email)} Hitung mundur selesai. Mencoba Spin lagi...`);
                this.checkAndSpin(account); 
            } else {
                 this.countdowns[account.uid] = { intervalId: intervalId, remaining: remainingDuration };
            }
        }, 1000);

        this.countdowns[account.uid] = { intervalId: intervalId, remaining: remainingDuration };
        logger.clearLine();
        process.stdout.write(
            `Akun ${this._maskEmail(account.email)} Hitung mundur Spin berikutnya: ${this.formatTimeRemaining(remainingDuration)}`
        );
    }

    async checkAllAccounts() {
        logger.info(`Mulai memeriksa semua akun untuk Spin...`);
        const results = await Promise.allSettled(this.accounts.map(account => {
            if (!this.countdowns[account.uid]) {
                return this.checkAndSpin(account);
            } else {
                logger.info(`Akun ${this._maskEmail(account.email)} masih dalam hitung mundur. Lewati Spin saat ini.`);
                return Promise.resolve();
            }
        }));
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                logger.error(`Gagal memproses akun ${this._maskEmail(this.accounts[index].email)}: ${result.reason}`);
            }
        });
    }

    start() {
        logger.success(`Bot telah dimulai`);
        
        this.spinAndCheckAccounts();

        cron.schedule(`3 */4 * * *`, () => { 
            this.spinAndCheckAccounts();
        });

        logger.info(`Bot akan melakukan operasi spin setiap 4 jam 3 menit dan memeriksa akun setelah selesai`);
    }
    
    async spinAndCheckAccounts() {
        logger.info(`Memulai siklus operasi Spin...`);
        await this.checkAllAccounts();
        
        const hasActiveCountdowns = Object.keys(this.countdowns).length > 0;
        
        if (hasActiveCountdowns) {
            logger.info(`Beberapa akun masih dalam hitung mundur Spin. Status akun tidak akan ditampilkan sampai semua hitung mundur selesai.`);
        } else {
            logger.info(`Siklus Spin selesai. Menampilkan status akun...`);
            this.displayAccountsTable();
        }
    }

    async _askForProxyUsage() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question('Apakah Anda ingin mengaktifkan proxy? (y/n): ', (answer) => {
                const enable = answer.toLowerCase() === 'y';
                rl.close();
                resolve(enable);
            });
        });
    }

    _loadProxies() {
        const proxies = {};
        const proxyFilePath = path.join(process.cwd(), 'data', 'proxy.txt');
        
        if (!fs.existsSync(proxyFilePath)) {
            return proxies;
        }
        
        try {
            const lines = fs.readFileSync(proxyFilePath, 'utf8').split('\n');
            
            for (const line of lines) {
                if (!line.trim() || line.trim().startsWith('#')) continue;
                
                const parts = line.trim().split('=');
                if (parts.length !== 2) continue;
                
                const email = parts[0].trim();
                const proxyUrl = parts[1].trim();
                
                if (email && proxyUrl) {
                    proxies[email] = proxyUrl;
                }
            }
        } catch (error) {
            console.error(`Gagal membaca konfigurasi proxy: ${error.message}`);
        }
        
        return proxies;
    }

    _checkAndCreateDataFiles() {
        const dataDir = path.join(process.cwd(), 'data');
        
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        const proxyPath = path.join(dataDir, 'proxy.txt');
        if (!fs.existsSync(proxyPath)) {
            const proxyExample = 
`# File konfigurasi proxy
# Format: email=proxy_url
# Contoh:
# example@gmail.com=socks5://127.0.0.1:1080
# example2@gmail.com=http://user:pass@127.0.0.1:8080`;
            fs.writeFileSync(proxyPath, proxyExample, 'utf8');
        }
        
        const tokensPath = path.join(dataDir, 'tokens.txt');
        if (!fs.existsSync(tokensPath)) {
            const tokensExample = '# Tambahkan satu JWT token per baris di file ini';
            fs.writeFileSync(tokensPath, tokensExample, 'utf8');
        }
    }
}

async function main() {
    const bot = new AutoSpinBot();
    logger.printBanner(bot.bannerText);
    
    logger.info('GLOB Auto Spin Bot | Sedang menginisialisasi...');
    
    await bot.initialize();
    bot.start();
}

main().catch(error => {
    logger.error(`Program mengalami kesalahan: ${error.message}`);
    process.exit(1);
});
