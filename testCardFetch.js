const CardEmbeddingService = require('./cardEmbeddings');
const fs = require('fs').promises;
const path = require('path');

async function getDirectorySize(dirPath) {
    let totalSize = 0;
    const files = await fs.readdir(dirPath);
    
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.isDirectory()) {
            totalSize += await getDirectorySize(filePath);
        } else {
            totalSize += stats.size;
        }
    }
    
    return totalSize;
}

async function testCardFetch(forceRefresh = false) {
    try {
        console.log('Initializing Card Embedding Service...');
        const cardService = new CardEmbeddingService();
        
        if (forceRefresh) {
            console.log('Force refreshing card data...');
            try {
                await fs.rm(cardService.cardsDir, { recursive: true, force: true });
                console.log('Deleted existing card data directory');
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }
        }
        
        console.log('Starting card fetch process...');
        await cardService.initialize();
        
        // Get some sample cards to verify the data
        const allCards = cardService.getAllCards();
        console.log('\nSample of fetched cards:');
        
        // Display 5 random cards
        const sampleSize = 5;
        const sampleCards = Array.from(allCards.values())
            .sort(() => Math.random() - 0.5)
            .slice(0, sampleSize);
            
        sampleCards.forEach(card => {
            console.log('\n-------------------');
            console.log(`Name: ${card.name}`);
            console.log(`Type: ${card.type_line}`);
            console.log(`Mana Cost: ${card.mana_cost}`);
            console.log(`Oracle Text: ${card.oracle_text}`);
            console.log(`Color Identity: ${card.color_identity.join('')}`);
            console.log(`EDHREC Rank: ${card.edhrec_rank || 'N/A'}`);
        });
        
        // Show directory size
        try {
            const totalSize = await getDirectorySize(cardService.cardsDir);
            console.log(`\nTotal card data size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
        } catch (error) {
            console.log('\nCould not calculate directory size:', error.message);
        }
        
    } catch (error) {
        console.error('Error in test:', error);
    }
}

// Check if force refresh is requested
const forceRefresh = process.argv.includes('--force-refresh');
testCardFetch(forceRefresh); 