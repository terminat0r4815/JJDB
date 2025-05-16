const fs = require('fs-extra');
const path = require('path');
const ejs = require('ejs');
require('dotenv').config();

const BUILD_DIR = 'dist';

async function build() {
    try {
        // Create build directory
        await fs.ensureDir(BUILD_DIR);

        // Create config file with API key
        const configContent = `window.CONFIG = {
    OPENAI_API_KEY: "${process.env.OPENAI_API_KEY || ''}"
};`;
        await fs.writeFile(path.join(BUILD_DIR, 'config.js'), configContent);

        // Copy and process index.html
        const indexHtml = await fs.readFile('index.html', 'utf-8');
        const processedHtml = indexHtml.replace(
            '</head>',
            '    <script src="config.js"></script>\n</head>'
        );
        await fs.writeFile(path.join(BUILD_DIR, 'index.html'), processedHtml);

        // Copy other necessary files
        await fs.copy('style.css', path.join(BUILD_DIR, 'style.css'));
        await fs.copy('script.js', path.join(BUILD_DIR, 'script.js'));
        await fs.copy('cardEmbeddings.js', path.join(BUILD_DIR, 'cardEmbeddings.js'));
        await fs.copy('server.js', path.join(BUILD_DIR, 'server.js'));
        
        // Copy card_data directory if it exists
        if (await fs.pathExists('card_data')) {
            await fs.copy('card_data', path.join(BUILD_DIR, 'card_data'));
        }

        console.log('Build completed successfully!');
    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

build(); 