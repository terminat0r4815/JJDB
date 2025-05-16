const CardEmbeddingService = require('./cardEmbeddings');

// This simulates how GPT would interact with the embedding service
async function simulateGptInteraction() {
    console.log('Initializing Card Embedding Service...');
    const service = new CardEmbeddingService();
    
    try {
        // Initialize the service
        await service.initialize();
        console.log('Service initialized successfully!');

        // Example 1: User wants card draw
        console.log('\nExample 1: User wants card draw');
        const drawCards = await service.findCardsBySemanticQuery('cards that let me draw more cards', 3);
        console.log('GPT would suggest these cards:');
        drawCards.forEach((result, index) => {
            console.log(`${index + 1}. ${result.card.name} (Similarity: ${result.similarity.toFixed(3)})`);
            console.log(`   Type: ${result.card.type_line}`);
            console.log(`   Text: ${result.card.oracle_text}`);
            console.log('---');
        });

        // Example 2: User wants removal
        console.log('\nExample 2: User wants removal');
        const removalCards = await service.findCardsBySemanticQuery('cards that can destroy or exile creatures', 3);
        console.log('GPT would suggest these cards:');
        removalCards.forEach((result, index) => {
            console.log(`${index + 1}. ${result.card.name} (Similarity: ${result.similarity.toFixed(3)})`);
            console.log(`   Type: ${result.card.type_line}`);
            console.log(`   Text: ${result.card.oracle_text}`);
            console.log('---');
        });

        // Example 3: Finding synergistic cards
        if (drawCards.length > 0) {
            const firstCard = drawCards[0].card;
            console.log(`\nExample 3: Finding cards that work well with ${firstCard.name}`);
            const synergisticCards = await service.findSynergisticCards(firstCard.id, 3);
            console.log('GPT would suggest these synergistic cards:');
            synergisticCards.forEach((result, index) => {
                console.log(`${index + 1}. ${result.card.name} (Similarity: ${result.similarity.toFixed(3)})`);
                console.log(`   Type: ${result.card.type_line}`);
                console.log(`   Text: ${result.card.oracle_text}`);
                console.log('---');
            });
        }
        
    } catch (error) {
        console.error('Error during testing:', error);
    }
}

// Run the test
simulateGptInteraction(); 