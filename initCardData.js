const fs = require('fs').promises;
const path = require('path');

async function initializeCardDataStructure() {
    const cardDataDir = path.join(__dirname, 'card_data');
    const colorCombos = [
        'W', 'U', 'B', 'R', 'G',          // Mono colors
        'WU', 'WB', 'WR', 'WG',           // White pairs
        'UB', 'UR', 'UG',                 // Blue pairs
        'BR', 'BG',                       // Black pairs
        'RG',                             // Red pairs
        'WUB', 'WUR', 'WUG',             // Three colors
        'WBR', 'WBG', 'WRG',
        'UBR', 'UBG', 'URG',
        'BRG',
        'WUBR', 'WUBG', 'WURG', 'WBRG', 'UBRG', // Four colors
        'WUBRG',                          // Five colors
        'colorless'                       // Colorless
    ];

    try {
        // Create main card_data directory
        await fs.mkdir(cardDataDir, { recursive: true });
        console.log('Created main card_data directory');

        // Create color combination directories
        for (const combo of colorCombos) {
            const colorDir = path.join(cardDataDir, combo);
            await fs.mkdir(colorDir, { recursive: true });
            console.log(`Created directory for ${combo}`);
        }

        // Create empty progress.json
        const progressFile = path.join(cardDataDir, 'progress.json');
        const initialProgress = {
            lastProcessedPage: 0,
            totalCards: 0,
            timestamp: new Date().toISOString()
        };
        await fs.writeFile(progressFile, JSON.stringify(initialProgress, null, 2));
        console.log('Created progress.json file');

        console.log('Card data directory structure initialized successfully!');
    } catch (error) {
        console.error('Error initializing card data structure:', error);
    }
}

// Run the initialization
initializeCardDataStructure(); 