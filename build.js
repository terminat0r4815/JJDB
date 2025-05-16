const fs = require('fs-extra');
const path = require('path');
const ejs = require('ejs');
require('dotenv').config();

const BUILD_DIR = 'dist';

async function build() {
    try {
        // Create build directory
        await fs.ensureDir(BUILD_DIR);

        // Create config file with API key and organization ID
        const apiKey = process.env.OPENAI_API_KEY;
        const orgId = process.env.OPENAI_ORGANIZATION_ID;
        
        if (!apiKey) {
            console.error('WARNING: OPENAI_API_KEY environment variable is not set!');
        }
        if (!orgId) {
            console.error('WARNING: OPENAI_ORGANIZATION_ID environment variable is not set!');
        }

        const configContent = `window.CONFIG = {
    OPENAI_API_KEY: "${apiKey || ''}",
    OPENAI_ORGANIZATION_ID: "${orgId || ''}"
};
console.log("Config loaded:", 
    window.CONFIG.OPENAI_API_KEY ? "API Key present" : "API Key missing",
    window.CONFIG.OPENAI_ORGANIZATION_ID ? ", Organization ID present" : ", Organization ID missing");`;

        await fs.writeFile(path.join(BUILD_DIR, 'config.js'), configContent);
        console.log('Created config.js with API key status:', apiKey ? 'present' : 'missing',
            'and organization ID status:', orgId ? 'present' : 'missing');

        // Copy and process index.html
        const indexHtml = await fs.readFile('index.html', 'utf-8');
        const processedHtml = indexHtml.replace(
            '</head>',
            '    <script src="config.js"></script>\n</head>'
        );
        await fs.writeFile(path.join(BUILD_DIR, 'index.html'), processedHtml);
        console.log('Processed index.html');

        // Copy other necessary files
        const filesToCopy = ['style.css', 'script.js', 'cardEmbeddings.js', 'server.js'];
        for (const file of filesToCopy) {
            if (await fs.pathExists(file)) {
                await fs.copy(file, path.join(BUILD_DIR, file));
                console.log(`Copied ${file}`);
            }
        }
        
        // Copy card_data directory if it exists
        if (await fs.pathExists('card_data')) {
            await fs.copy('card_data', path.join(BUILD_DIR, 'card_data'));
            console.log('Copied card_data directory');
        }

        console.log('Build completed successfully!');
    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

build(); 