const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
const readline = require('readline'); // Diperlukan untuk askForProxyUsage

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

// Logger sederhana untuk output konsol
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

// Proxy Manager sederhana (diintegrasikan)
const proxyManager = {
    proxies: {},
    enableProxy: false, // Akan diatur dari Config
    
    async initialize() {
        // Logika untuk bertanya penggunaan proxy dan memuat proxy akan dipindahkan ke AutoSpinBot
    },

    getProxyAgent(email) {
        if (!this.enableProxy) {
            return null;
        }
        const proxyUrl = this.proxies[email];
        if (!proxyUrl) {
            return null;
        }
        // Implementasi agen proxy (misalnya, 'https-proxy-agent' atau 'socks-proxy-agent')
        // Untuk contoh ini, kita akan mengembalikan URL proxy saja, Anda perlu menginstal
        // dan mengkonfigurasi modul agen proxy yang sesuai di lingkungan Anda.
        // Contoh: return new HttpsProxyAgent(proxyUrl);
        // Atau: return new SocksProxyAgent(proxyUrl);
        logger.warn(`Proxy untuk ${email} terdeteksi: ${proxyUrl}. Pastikan Anda memiliki modul agen proxy yang terinstal.`);
        return proxyUrl; // Mengembalikan URL proxy, perlu diubah menjadi agen yang sebenarnya
    }
};

class AutoSpinBot {
    constructor() {
        this.API_BASE_URL = 'https://api-iowa.shaga.xyz';
        this.accounts = [];
        this.countdowns = {};
        this.enableProxy = false; // Dari config
        this.checkInterval = 3600; // Dari config, dalam detik (default setiap jam)

        // Banner teks sederhana
        this.bannerText = `
=====================================
 GLOB Auto Spin Bot
 Dibuat oleh: @0xjiushi21 (Twitter)
             @zclsx (GitHub)
=====================================
        `;

        // ID QUEST untuk operasi spin, berdasarkan temuan Anda.
        this.QUEST_ID = '6bb26924-e6ee-473f-8ad0-5e743c3f3e1f'; 
    }

    async initialize() {
        try {
            // Pastikan direktori dan file data ada
            this._checkAndCreateDataFiles();
            
            // Tanya pengguna apakah akan mengaktifkan proxy
            this.enableProxy = await this._askForProxyUsage();
            proxyManager.enableProxy = this.enableProxy; // Atur di proxyManager

            if (this.enableProxy) {
                proxyManager.proxies = this._loadProxies();
                if (Object.keys(proxyManager.proxies).length === 0) {
                    logger.warn('Proxy diaktifkan, tetapi tidak ada konfigurasi proxy yang ditemukan di data/proxy.txt.');
                } else {
                    logger.info(`Memuat ${Object.keys(proxyManager.proxies).length} konfigurasi proxy.`);
                }
            }

            // Baca file tokens dari direktori data
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
            // Dapatkan status proxy
            const hasProxy = proxyManager.getProxyAgent(account.email) ? 'Dikonfigurasi' : 'Tidak Dikonfigurasi';
            // Sembunyikan email
            const maskedEmail = this._maskEmail(account.email);
            // Sembunyikan uid, hanya tampilkan 6 karakter pertama dan 4 karakter terakhir
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

    // Fungsi checkCanSpin dihapus karena endpointnya tidak ditemukan atau tidak diperlukan.
    // Status cooldown akan didapatkan langsung dari respons performSpin.

    async performSpin(account) {
        try {
            // Dapatkan agen proxy untuk akun
            const proxyAgentUrl = proxyManager.getProxyAgent(account.email);
            const axiosConfig = {
                headers: {
                    'authorization': `Bearer ${account.token}`,
                    'accept': 'application/json',
                    'content-type': 'application/json',
                    'origin': 'https://glob.shaga.xyz',
                    'referer': 'https://glob.shaga.xyz/'
                }
            };
            
            // Jika ada proxy, tambahkan ke konfigurasi axios
            if (proxyAgentUrl) {
                // Anda perlu menginstal 'https-proxy-agent' atau 'socks-proxy-agent'
                // dan menginisialisasinya di sini. Contoh:
                // const { HttpsProxyAgent } = require('https-proxy-agent');
                // axiosConfig.httpsAgent = new HttpsProxyAgent(proxyAgentUrl);
                logger.warn(`Menggunakan proxy: ${proxyAgentUrl} untuk akun ${this._maskEmail(account.email)}. Pastikan modul agen proxy terinstal.`);
            }
            
            // Menggunakan QUEST_ID untuk endpoint spin, dan mengirim body kosong
            const response = await axios.post(
                `${this.API_BASE_URL}/quests/${this.QUEST_ID}`,
                {}, // Body kosong seperti yang terlihat di permintaan manual Anda
                axiosConfig
            );
            return response.data;
        } catch (error) {
            // Tangani respons kesalahan dari server
            if (error.response && error.response.data) {
                // Jika server mengembalikan pesan cooldown, kita tangani di sini
                if (error.response.data.message === "Cooldown period not over yet") {
                    logger.warn(`Akun ${this._maskEmail(account.email)}: ${error.response.data.message}`);
                    return {
                        message: error.response.data.message,
                        nextSpinDurationMs: error.response.data.nextSpinDurationMs // Asumsi server mengirim ini
                    };
                }
                // Jika ada kesalahan lain dari server (misalnya, token tidak valid, dll.)
                logger.error(`Akun ${this._maskEmail(account.email)} Spin gagal dengan respons server: ${JSON.stringify(error.response.data)}`);
                return error.response.data; // Kembalikan data kesalahan dari server
            }
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
        // Langsung coba melakukan spin
        logger.info(`Akun ${this._maskEmail(account.email)} sedang mencoba melakukan Spin...`);
        const spinResult = await this.performSpin(account);
        
        if (spinResult) {
            if (spinResult.message === "Cooldown period not over yet") {
                // Jika ada pesan cooldown, mulai hitung mundur
                this.startCountdown(account, spinResult.nextSpinDurationMs);
            } else if (spinResult.rewards) {
                // Jika berhasil spin dan ada hadiah
                logger.success(`Akun ${this._maskEmail(account.email)} Spin berhasil!`);
                logger.info(`Akun ${this._maskEmail(account.email)} mendapatkan hadiah: ${JSON.stringify(spinResult.rewards)}`);
                // Setelah spin berhasil, asumsikan perlu cooldown lagi (misal 4 jam)
                // Jika API tidak memberikan nextSpinDurationMs setelah spin berhasil,
                // Anda mungkin perlu mengatur default cooldown di sini.
                this.startCountdown(account, 4 * 60 * 60 * 1000); // Default 4 jam
            } else {
                // Tangani kasus lain jika respons tidak memiliki 'message' atau 'rewards'
                logger.error(`Akun ${this._maskEmail(account.email)} Spin gagal atau respons tidak terduga: ${JSON.stringify(spinResult)}`);
            }
        } else {
            logger.error(`Akun ${this._maskEmail(account.email)} Spin gagal tanpa respons yang jelas.`);
        }
    }

    startCountdown(account, duration) {
        if (this.countdowns[account.uid]) {
            // Jika sudah ada hitung mundur aktif untuk akun ini, jangan mulai yang baru
            return;
        }

        const initialDuration = duration; // Simpan durasi awal untuk referensi
        const updateInterval = setInterval(() => {
            logger.clearLine();
            process.stdout.write(
                `Akun ${this._maskEmail(account.email)} Hitung mundur Spin berikutnya: ${this.formatTimeRemaining(duration)}`
            );
            
            duration -= 1000; // Kurangi 1 detik
            if (duration <= 0) {
                clearInterval(updateInterval);
                delete this.countdowns[account.uid];
                logger.info(`Akun ${this._maskEmail(account.email)} Hitung mundur selesai. Mencoba Spin lagi...`);
                this.checkAndSpin(account); // Coba spin lagi setelah hitung mundur selesai
            }
        }, 1000);

        this.countdowns[account.uid] = updateInterval;
        // Tampilkan status awal hitung mundur segera
        logger.clearLine();
        process.stdout.write(
            `Akun ${this._maskEmail(account.email)} Hitung mundur Spin berikutnya: ${this.formatTimeRemaining(initialDuration)}`
        );
    }

    async checkAllAccounts() {
        logger.info(`Mulai memeriksa semua akun...`);
        // Gunakan Promise.allSettled untuk menangani kegagalan individu tanpa menghentikan semua
        const results = await Promise.allSettled(this.accounts.map(account => this.checkAndSpin(account)));
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                logger.error(`Gagal memproses akun ${this._maskEmail(this.accounts[index].email)}: ${result.reason}`);
            }
        });
    }

    start() {
        logger.success(`Bot telah dimulai`);
        
        // Jalankan sekali segera
        this.spinAndCheckAccounts();

        // Atur untuk berjalan setiap 4 jam 3 menit (243 menit)
        cron.schedule(`3 */4 * * *`, () => {
            this.spinAndCheckAccounts();
        });

        logger.info(`Bot akan melakukan operasi spin setiap 4 jam 3 menit dan memeriksa akun setelah selesai`);
    }
    
    async spinAndCheckAccounts() {
        logger.info(`Mulai melakukan operasi spin...`);
        // Lakukan operasi spin terlebih dahulu
        await this.checkAllAccounts();
        
        // Periksa apakah ada akun yang dalam status hitung mundur
        const hasActiveCountdowns = Object.keys(this.countdowns).length > 0;
        
        if (hasActiveCountdowns) {
            logger.info(`Setidaknya ada satu akun yang menunggu waktu Spin berikutnya, tabel status akun tidak akan ditampilkan`);
        } else {
            // Hanya tampilkan status akun jika tidak ada hitung mundur aktif
            logger.info(`Operasi Spin selesai, sedang memeriksa status akun...`);
            this.displayAccountsTable();
        }
    }

    // --- Logika dari config.js diintegrasikan di sini ---

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
        
        // Periksa apakah file ada
        if (!fs.existsSync(proxyFilePath)) {
            return proxies;
        }
        
        try {
            const lines = fs.readFileSync(proxyFilePath, 'utf8').split('\n');
            
            for (const line of lines) {
                // Lewati baris kosong dan komentar
                if (!line.trim() || line.trim().startsWith('#')) continue;
                
                // Format: email=proxy_url
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
        
        // Pastikan direktori data ada
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        // Periksa dan buat proxy.txt
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
        
        // Periksa tokens.txt
        const tokensPath = path.join(dataDir, 'tokens.txt');
        if (!fs.existsSync(tokensPath)) {
            const tokensExample = '# Tambahkan satu JWT token per baris di file ini';
            fs.writeFileSync(tokensPath, tokensExample, 'utf8');
        }
    }
}

// Mulai Bot
async function main() {
    const bot = new AutoSpinBot();
    logger.printBanner(bot.bannerText); // Tampilkan banner sederhana
    
    logger.info('GLOB Auto Spin Bot | Sedang menginisialisasi...');
    
    // Inisialisasi bot (yang sekarang mencakup inisialisasi proxy dan pemuatan token)
    await bot.initialize();
    bot.start();
}

main().catch(error => {
    logger.error(`Program mengalami kesalahan: ${error.message}`);
    process.exit(1);
});
