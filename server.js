const express = require('express');
const path = require('path');
const CardEmbeddingService = require('./cardEmbeddings');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// Initialize the card embedding service
const cardService = new CardEmbeddingService();

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Add CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// OpenAI API endpoints
app.post('/api/generate-search-parameters', async (req, res) => {
    try {
        const { systemPrompt, userContent, tools, toolChoice, maxTokens, temperature } = req.body;
        
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4',
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent }
            ],
            tools: tools,
            tool_choice: toolChoice,
            max_tokens: maxTokens || 500,
            temperature: temperature || 0.2
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error in generate-search-parameters:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Error calling OpenAI API',
            details: error.response?.data || error.message
        });
    }
});

app.post('/api/generate-themed-deck', async (req, res) => {
    try {
        const { fullPromptForPhase2 } = req.body;
        
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4',
            messages: [
                { role: "user", content: fullPromptForPhase2 }
            ],
            max_tokens: 1500,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error in generate-themed-deck:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Error calling OpenAI API',
            details: error.response?.data || error.message
        });
    }
});

app.post('/api/analyze-commander', async (req, res) => {
    try {
        const { systemPrompt, userPrompt } = req.body;
        
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4',
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            max_tokens: 1000,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error in analyze-commander:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Error calling OpenAI API',
            details: error.response?.data || error.message
        });
    }
});

app.post('/api/generate-name-suggestions', async (req, res) => {
    try {
        const { systemPrompt, userPrompt } = req.body;
        
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4',
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            max_tokens: 500,
            temperature: 0.8
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error in generate-name-suggestions:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Error calling OpenAI API',
            details: error.response?.data || error.message
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

// Initialize the card service before starting the server
(async () => {
    try {
        console.log('Initializing card service...');
        await cardService.initialize();
        console.log('Card service initialized successfully!');
        
        // Start the server after initialization
        const server = app.listen(port, () => {
            console.log(`Server running at http://localhost:${port}`);
            console.log('Press Ctrl+C to stop the server');
        });

        // Handle server shutdown gracefully
        process.on('SIGINT', () => {
            console.log('\nShutting down server...');
            server.close(() => {
                console.log('Server stopped');
                process.exit(0);
            });
        });

    } catch (error) {
        console.error('Failed to initialize card service:', error);
        process.exit(1);
    }
})();

// Helper function to process image URIs
function processImageUris(card) {
    let image_uris = {
        front: { normal: null },
        back: { normal: null },
        isDoubleFaced: false
    };

    // Handle double-faced cards
    if (card.card_faces && card.card_faces.length > 0) {
        image_uris.isDoubleFaced = true;
        image_uris.front.normal = card.card_faces[0].image_uris?.normal || card.card_faces[0].image_url;
        image_uris.back.normal = card.card_faces[1].image_uris?.normal || card.card_faces[1].image_url;
    }
    // Handle single-faced cards
    else if (card.image_uris) {
        if (card.image_uris.front?.front?.normal) {
            image_uris.front.normal = card.image_uris.front.front.normal;
        } else if (card.image_uris.front?.normal) {
            image_uris.front.normal = card.image_uris.front.normal;
        } else if (card.image_uris.normal) {
            image_uris.front.normal = card.image_uris.normal;
        }
    }
    // Handle direct image_url
    else if (card.image_url) {
        image_uris.front.normal = card.image_url;
    }

    // Ensure URLs are absolute
    if (image_uris.front.normal && !image_uris.front.normal.startsWith('http')) {
        image_uris.front.normal = `https://api.scryfall.com${image_uris.front.normal}`;
    }
    if (image_uris.back.normal && !image_uris.back.normal.startsWith('http')) {
        image_uris.back.normal = `https://api.scryfall.com${image_uris.back.normal}`;
    }

    // Fallback for missing images
    if (!image_uris.front.normal) {
        image_uris.front.normal = 'https://c1.scryfall.com/file/scryfall-card-backs/large/59/597b79b3-7d77-4261-871a-60dd17403388.jpg?1562638020';
    }

    return image_uris;
}

// API Endpoints
app.post('/api/cards/search', async (req, res) => {
    console.log("Received search request:", req.body);
    try {
        const { searchType, query, options } = req.body;
        let results;

        if (searchType === 'semantic') {
            const searchOptions = {
                ...options,
                isCommanderSearch: query.toLowerCase().includes('commander'),
                minSimilarity: 0.1,
                limit: 20,
                searchComponents: ['name', 'type', 'abilities', 'theme']
            };

            results = await cardService.searchCards(query, searchOptions);
            
            // Process results to ensure proper image_uris handling
            results = results.map(result => {
                const card = result.card;
                const image_uris = processImageUris(card);
                
                console.log(`Processing card: ${card.name}`);
                console.log('Image URIs:', image_uris);
                
                return {
                    ...result,
                    card: {
                        ...card,
                        image_uris: image_uris
                    }
                };
            });
            
            console.log(`Found ${results.length} potential matches`);
            if (results.length > 0) {
                console.log('Top matches:');
                results.slice(0, 5).forEach((result, index) => {
                    console.log(`${index + 1}. ${result.card.name} (Similarity: ${result.similarity.toFixed(3)})`);
                    console.log(`   Image URIs:`, result.card.image_uris);
                });
            }
        } else {
            results = await cardService.searchCards(query, options);
        }

        res.json(results);
    } catch (error) {
        console.error('Error searching cards:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/cards/by-color', async (req, res) => {
    try {
        const colors = req.query.colors ? req.query.colors.split('') : [];
        const limit = parseInt(req.query.limit) || 20;
        
        const results = cardService.getCardsByColorIdentity(colors);
        res.json(results.slice(0, limit));
    } catch (error) {
        console.error('Error getting cards by color:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/cards/by-type', async (req, res) => {
    try {
        const type = req.query.type;
        const limit = parseInt(req.query.limit) || 20;
        
        if (!type) {
            return res.status(400).json({ error: 'Type parameter is required' });
        }

        const results = cardService.getCardsByType(type);
        res.json(results.slice(0, limit));
    } catch (error) {
        console.error('Error getting cards by type:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/cards/by-cmc', async (req, res) => {
    try {
        const cmc = parseInt(req.query.cmc);
        const limit = parseInt(req.query.limit) || 20;
        
        if (isNaN(cmc)) {
            return res.status(400).json({ error: 'Valid CMC parameter is required' });
        }

        const results = cardService.getCardsByManaValue(cmc);
        res.json(results.slice(0, limit));
    } catch (error) {
        console.error('Error getting cards by CMC:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/cards/details/:id', async (req, res) => {
    try {
        const cardId = req.params.id;
        const card = cardService.getCard(cardId);
        
        if (!card) {
            return res.status(404).json({ error: 'Card not found' });
        }

        res.json(card);
    } catch (error) {
        console.error('Error getting card details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/cards/random', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 5;
        const allCards = cardService.getAllCards();
        
        // Get random cards
        const randomCards = Array.from(allCards.values())
            .sort(() => Math.random() - 0.5)
            .slice(0, limit);
            
        res.json(randomCards);
    } catch (error) {
        console.error('Error getting random cards:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});