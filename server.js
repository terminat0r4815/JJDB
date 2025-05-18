// Load environment variables first
require('dotenv').config();

// Debug logging for environment variables
console.log('Environment variables loaded:', {
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasOpenAIOrg: !!process.env.OPENAI_ORGANIZATION_ID,
    nodeEnv: process.env.NODE_ENV
});

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
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// Test endpoint that also validates environment
app.get('/api/test', (req, res) => {
    // Check if required environment variables are set
    const requiredVars = ['OPENAI_API_KEY'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
        return res.status(500).json({ 
            error: 'Missing required environment variables', 
            missing: missingVars 
        });
    }
    
    res.json({ 
        message: 'Server is running!',
        environment: process.env.NODE_ENV,
        apiConfigured: true
    });
});

// Helper function to get OpenAI headers with better error handling
function getOpenAIHeaders() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY environment variable.');
    }

    const headers = {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
    };
    
    if (process.env.OPENAI_ORGANIZATION_ID) {
        headers['OpenAI-Organization'] = process.env.OPENAI_ORGANIZATION_ID;
    }
    
    return headers;
}

// OpenAI API endpoints
app.post('/api/generate-search-parameters', async (req, res) => {
    console.log('Received request to /api/generate-search-parameters');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Request headers:', req.headers);
    
    try {
        const { systemPrompt, userPrompt, tools, toolChoice, maxTokens, temperature } = req.body;
        
        // Log the extracted values
        console.log('Extracted values:', {
            hasSystemPrompt: !!systemPrompt,
            systemPromptLength: systemPrompt?.length,
            hasUserPrompt: !!userPrompt,
            userPromptLength: userPrompt?.length,
            hasTools: !!tools,
            toolsLength: tools?.length,
            hasToolChoice: !!toolChoice,
            maxTokens,
            temperature
        });
        
        // Validate required fields
        if (!systemPrompt || !userPrompt) {
            console.error('Missing required fields:', { 
                systemPrompt: !!systemPrompt, 
                userPrompt: !!userPrompt,
                systemPromptType: typeof systemPrompt,
                userPromptType: typeof userPrompt
            });
            return res.status(400).json({ 
                error: 'Missing required fields',
                details: {
                    systemPrompt: !!systemPrompt,
                    userPrompt: !!userPrompt,
                    systemPromptType: typeof systemPrompt,
                    userPromptType: typeof userPrompt
                }
            });
        }

        // Check OpenAI API key and organization ID
        if (!process.env.OPENAI_API_KEY) {
            console.error('OpenAI API key is not set in environment variables');
            return res.status(500).json({ error: 'OpenAI API key not configured on server' });
        }

        if (!process.env.OPENAI_ORGANIZATION_ID) {
            console.error('OpenAI Organization ID is not set in environment variables');
            return res.status(500).json({ error: 'OpenAI Organization ID not configured on server' });
        }

        console.log('Making request to OpenAI with params:', {
            systemPrompt: systemPrompt?.substring(0, 50) + '...',
            userPrompt: userPrompt?.substring(0, 50) + '...',
            hasTools: !!tools,
            hasToolChoice: !!toolChoice,
            maxTokens,
            temperature
        });

        const openAIRequestBody = {
            model: 'gpt-4',
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            tools: tools,
            tool_choice: toolChoice,
            max_tokens: maxTokens || 500,
            temperature: temperature || 0.2
        };

        console.log('OpenAI request body:', JSON.stringify(openAIRequestBody, null, 2));

        const response = await axios.post('https://api.openai.com/v1/chat/completions', 
            openAIRequestBody,
            { headers: getOpenAIHeaders() }
        );

        console.log('OpenAI response status:', response.status);
        console.log('OpenAI response has choices:', !!response.data?.choices);
        console.log('OpenAI response data:', JSON.stringify(response.data, null, 2));

        res.json(response.data);
    } catch (error) {
        console.error('Detailed error in generate-search-parameters:', {
            message: error.message,
            response: error.response?.data,
            stack: error.stack,
            requestBody: req.body,
            requestHeaders: req.headers
        });

        // Send a more detailed error response
        res.status(500).json({
            error: 'Error calling OpenAI API',
            details: error.response?.data || error.message,
            type: error.name,
            path: '/api/generate-search-parameters',
            requestInfo: {
                bodyKeys: Object.keys(req.body),
                contentType: req.headers['content-type']
            }
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
            headers: getOpenAIHeaders()
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
        const { systemPrompt, userPrompt, tools, maxTokens, temperature } = req.body;

        // Check OpenAI API key and organization ID
        if (!process.env.OPENAI_API_KEY) {
            console.error('OpenAI API key is not set in environment variables');
            return res.status(500).json({ error: 'OpenAI API key not configured on server' });
        }

        if (!process.env.OPENAI_ORGANIZATION_ID) {
            console.error('OpenAI Organization ID is not set in environment variables');
            return res.status(500).json({ error: 'OpenAI Organization ID not configured on server' });
        }
        
        const openAIRequestBody = {
            model: 'gpt-4',
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            max_tokens: maxTokens || 1000,
            temperature: temperature || 0.7
        };

        // Only add tools if they are provided
        if (tools) {
            openAIRequestBody.tools = tools;
            openAIRequestBody.tool_choice = { type: "function", function: { name: "search_cards" } };
        }

        const response = await axios.post('https://api.openai.com/v1/chat/completions', 
            openAIRequestBody,
            { headers: getOpenAIHeaders() }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Error in analyze-commander:', {
            message: error.message,
            response: error.response?.data,
            stack: error.stack,
            requestBody: req.body,
            requestHeaders: req.headers
        });

        // Send a more detailed error response
        res.status(500).json({
            error: 'Error calling OpenAI API',
            details: error.response?.data || error.message,
            type: error.name,
            path: '/api/analyze-commander',
            requestInfo: {
                bodyKeys: Object.keys(req.body),
                contentType: req.headers['content-type']
            }
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
            headers: getOpenAIHeaders()
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

// Add new endpoint for secondary commander analysis
app.post('/api/analyze-commanders', async (req, res) => {
    console.log("Received secondary commander analysis request:", req.body);
    try {
        const { commanders, deckConcept, systemPrompt, userPrompt } = req.body;
        
        // Call OpenAI API with the analysis request
        const response = await fetch(process.env.OPENAI_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4-turbo-preview",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt || "You are an expert Magic: The Gathering Commander deck analyst. Analyze these commanders and provide strategic insights."
                    },
                    {
                        role: "user",
                        content: userPrompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            throw new Error('Failed to get analysis from OpenAI');
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Error in secondary commander analysis:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add new endpoint for analyzing top commanders
app.post('/api/analyze-top-commanders', async (req, res) => {
    console.log("Received top commanders analysis request:", req.body);
    try {
        const { commanders, deckConcept } = req.body;
        
        const systemPrompt = `You are an expert Magic: The Gathering Commander deck analyst.
Your task is to analyze the provided commanders and select the best matches for the deck concept.

IMPORTANT GUIDELINES:
1. Analyze each commander's similarity score and mechanical fit
2. Select ONLY the commanders that are truly good fits (1-5 commanders)
3. Do not select commanders just to reach 5 selections
4. Consider both mechanical and thematic alignment
5. Pay special attention to commanders with similarity scores above 0.4

If you find suitable commanders, respond with:
SELECTED: [comma-separated list of indices]
[Detailed explanation for each selected commander]

If no commanders are suitable, respond with:
SEARCH: [new search query]
[Explanation of why current options don't work]

Your explanation should include:
1. Why each selected commander fits the concept
2. How their abilities align with the strategy
3. Any potential synergies between selected commanders
4. Suggestions for how they could work in the 99 if not chosen as the main commander`;

        const userPrompt = `Analyze these potential commanders for the deck concept: "${deckConcept}"

Commander Details:
${commanders.map((commander, index) => `
${index + 1}. ${commander.name} (Similarity Score: ${commander.similarity.toFixed(3)})
Type: ${commander.type_line}
Mana Cost: ${commander.mana_cost || 'N/A'}
Color Identity: ${commander.color_identity.join(',')}
Oracle Text: ${commander.oracle_text || 'N/A'}
${commander.power ? `Power/Toughness: ${commander.power}/${commander.toughness}` : ''}
${commander.keywords.length > 0 ? `Keywords: ${commander.keywords.join(', ')}` : ''}
`).join('\n')}

Your task:
1. Analyze how well each commander matches the deck concept
2. Consider their mechanical synergies, color identity, and effectiveness
3. Select ONLY the commanders that truly fit the concept (up to 5)
4. Provide detailed explanations for why each selected commander fits
5. If selecting fewer than 5, explain why these stand out from the others

Remember to start your response with either SELECTED: or SEARCH:`;

        // Check OpenAI API key and organization ID
        if (!process.env.OPENAI_API_KEY) {
            console.error('OpenAI API key is not set in environment variables');
            return res.status(500).json({ error: 'OpenAI API key not configured on server' });
        }

        if (!process.env.OPENAI_ORGANIZATION_ID) {
            console.error('OpenAI Organization ID is not set in environment variables');
            return res.status(500).json({ error: 'OpenAI Organization ID not configured on server' });
        }

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: userPrompt
                }
            ],
            temperature: 0.7,
            max_tokens: 1000
        }, {
            headers: getOpenAIHeaders()
        });

        console.log('OpenAI Response:', response.data);
        res.json(response.data);
    } catch (error) {
        console.error('Error in commander analysis:', error.response?.data || error.message);
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
    try {
        // Handle double-faced cards
        if (card.card_faces && card.card_faces.length > 0) {
            return {
                isDoubleFaced: true,
                front: card.card_faces[0].image_uris?.normal || card.card_faces[0].image_url,
                back: card.card_faces[1].image_uris?.normal || card.card_faces[1].image_url
            };
        }
        
        // Handle single-faced cards
        const imageUrl = card.image_uris?.normal || card.image_url;
        if (!imageUrl) {
            console.warn('No image URL found for card:', card.name);
            return null;
        }

        return {
            isDoubleFaced: false,
            normal: imageUrl
        };
    } catch (error) {
        console.error('Error processing image URIs for card:', card.name, error);
        return null;
    }
}

// API Endpoints
app.post('/api/cards/search', async (req, res) => {
    console.log("Received search request:", req.body);
    try {
        const { searchType, query, options } = req.body;
        
        // Remove color words from query if color identity is specified
        let processedQuery = query;
        if (options?.colorIdentity?.length > 0) {
            const colorWords = ['white', 'blue', 'black', 'red', 'green'];
            processedQuery = query.split(' ')
                .filter(word => !colorWords.includes(word.toLowerCase()))
                .join(' ');
        }

        // Validate search parameters
        if (!searchType || !processedQuery) {
            return res.status(400).json({
                error: 'Invalid search parameters',
                details: 'Search type and query are required'
            });
        }

        // Initialize search options with defaults
        const searchOptions = {
            searchComponents: ['name', 'type', 'abilities', 'oracle_text'],
            minSimilarity: 0.2,
            limit: 50,
            includePartialMatches: true,
            ...options
        };

        // Ensure minimum similarity is not too restrictive
        if (searchOptions.includePartialMatches) {
            searchOptions.minSimilarity = Math.min(searchOptions.minSimilarity, 0.15);
        }

        try {
            // Perform the search
            const results = await cardService.searchCards(processedQuery, searchOptions);
            
            if (!results || results.length === 0) {
                // Try a fallback search with more relaxed parameters
                console.log('No results found, trying fallback search...');
                const fallbackResults = await cardService.searchCards(processedQuery, {
                    ...searchOptions,
                    minSimilarity: 0.1,
                    includePartialMatches: true
                });
                
                if (fallbackResults && fallbackResults.length > 0) {
                    console.log(`Found ${fallbackResults.length} results with fallback search`);
                    // Format the fallback results
                    const formattedResults = fallbackResults.map(result => ({
                        name: result.card.name,
                        type_line: result.card.type_line,
                        oracle_text: result.card.oracle_text,
                        mana_cost: result.card.mana_cost,
                        cmc: result.card.cmc,
                        color_identity: result.card.color_identity,
                        keywords: result.card.keywords || [],
                        power: result.card.power,
                        toughness: result.card.toughness,
                        image_uris: result.card.image_uris,
                        card_faces: result.card.card_faces,
                        legalities: result.card.legalities,
                        edhrec_rank: result.card.edhrec_rank
                    }));
                    return res.json(formattedResults);
                }
            }
            
            // Format the results
            const formattedResults = results.map(result => ({
                name: result.card.name,
                type_line: result.card.type_line,
                oracle_text: result.card.oracle_text,
                mana_cost: result.card.mana_cost,
                cmc: result.card.cmc,
                color_identity: result.card.color_identity,
                keywords: result.card.keywords || [],
                power: result.card.power,
                toughness: result.card.toughness,
                image_uris: result.card.image_uris,
                card_faces: result.card.card_faces,
                legalities: result.card.legalities,
                edhrec_rank: result.card.edhrec_rank
            }));
            
            return res.json(formattedResults || []);
        } catch (searchError) {
            console.error('Error in card search:', searchError);
            return res.status(500).json({
                error: 'Search operation failed',
                details: searchError.message
            });
        }
    } catch (error) {
        console.error('Error processing search request:', error);
        return res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
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