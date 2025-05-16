const CardEmbeddingService = require('./cardEmbeddings');

async function testCardEmbeddings() {
    console.log('Initializing Card Embedding Service...');
    const service = new CardEmbeddingService();
    
    try {
        // Initialize the service
        await service.initialize();
        console.log('Service initialized successfully!');
        
        // Test finding cards by function
        console.log('\nFinding cards that function as board wipes...');
        const boardWipes = await service.findCardsByFunction('destroy all creatures', 5);
        console.log('Top 5 board wipes:');
        boardWipes.forEach((result, index) => {
            console.log(`${index + 1}. ${result.card.name} (Similarity: ${result.similarity.toFixed(3)})`);
        });
        
        // Test finding similar cards
        if (boardWipes.length > 0) {
            const firstCard = boardWipes[0].card;
            console.log(`\nFinding cards similar to ${firstCard.name}...`);
            const similarCards = await service.findSimilarCards(firstCard.id, 5);
            console.log('Top 5 similar cards:');
            similarCards.forEach((result, index) => {
                console.log(`${index + 1}. ${result.card.name} (Similarity: ${result.similarity.toFixed(3)})`);
            });
        }
        
    } catch (error) {
        console.error('Error during testing:', error);
    }
}

// Run the test
testCardEmbeddings(); 