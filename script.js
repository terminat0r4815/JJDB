// JavaScript for MTG AI Deck Builder will go here

// For local development, use localhost. For production, use the Render URL
const BACKEND_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://jjdb.onrender.com';
const SCRYFALL_API_BASE_URL = 'https://api.scryfall.com';

// const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // Removed: Not used for actual API calls from client
// const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'; // Removed: Not used for actual API calls from client

// Initialize on page load

// Simple validation function - API key is handled by backend
function validateApiKey() {
    return true;
}

// Definition of the card search tool for the AI
const CARD_SEARCH_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "search_cards",
        description: "Searches our local Magic: The Gathering card database using semantic search and oracle text search capabilities.",
        parameters: {
            type: "object",
            properties: {
                searchType: {
                    type: "string",
                    enum: ["semantic", "oracle", "hybrid"],
                    description: "Type of search to perform: 'semantic' for multi-dimensional search, 'oracle' for specific text search, or 'hybrid' for combined approach"
                },
                query: {
                    type: "string",
                    description: "The search query text to find matching cards"
                },
                options: {
                    type: "object",
                    properties: {
                        searchComponents: {
                            type: "array",
                            items: {
                                type: "string",
                                enum: ["name", "type", "abilities", "oracle_text", "flavor_text", "keywords"]
                            },
                            description: "Components to search in"
                        },
                        minSimilarity: {
                            type: "number",
                            minimum: 0,
                            maximum: 1,
                            description: "Minimum similarity threshold (0.1-0.3 recommended for broader results)"
                        },
                        colorIdentity: {
                            type: "array",
                            items: {
                                type: "string",
                                enum: ["W", "U", "B", "R", "G"]
                            },
                            description: "Filter by color identity"
                        },
                        cardType: {
                            type: "array",
                            items: {
                                type: "string"
                            },
                            description: "Filter by card type(s)"
                        },
                        limit: {
                            type: "number",
                            description: "Maximum number of results to return"
                        },
                        includePartialMatches: {
                            type: "boolean",
                            description: "Whether to include partial matches in results"
                        }
                    }
                }
            },
            required: ["searchType", "query"]
        }
    }
};

// System prompt for Phase 1: AI generates a card search query
const PHASE_1_SYSTEM_PROMPT = `You are an expert Magic: The Gathering Commander (EDH) deck architect.
Your primary task is to understand the user's desired deck theme and find a suitable commander that can lead that theme.

IMPORTANT: You MUST return a properly formatted JSON object with the following structure:
{
    "searchType": "semantic",
    "query": "your search text",
    "options": {
        "searchComponents": ["name", "type", "abilities", "theme", "keywords"],
        "minSimilarity": 0.15,
        "colorIdentity": ["W", "U", "B", "R", "G"],
        "cardType": "Legendary Creature",
        "limit": 50
    }
}

When formulating the search query, follow these guidelines:

1. THEME ANALYSIS:
   - Break down the theme into core concepts:
     * Visual elements (appearance, setting, environment)
     * Mechanical elements (actions, abilities, effects)
     * Flavor elements (story, lore, character traits)
     * Cultural elements (references, tropes, archetypes)
   - Consider relevant creature types that match the theme
   - Look for mechanics that represent the theme's actions
   - Include thematic keywords from Magic's history

2. QUERY STRUCTURE:
   - Start with "legendary creature"
   - Add primary thematic keywords
   - Include mechanical representations
   - Consider flavor words and descriptors
   - Balance specific terms with broader concepts
   - Use both literal and metaphorical matches

3. COLOR IDENTITY:
   - Analyze the theme's color philosophy:
     * White: Order, protection, unity, law
     * Blue: Knowledge, technology, control, perfection
     * Black: Ambition, power, sacrifice, corruption
     * Red: Passion, chaos, aggression, freedom
     * Green: Nature, growth, instinct, tradition
   - Only specify colors that strongly align with the theme's essence

4. THEME INTEGRATION:
   - Consider both direct and indirect representations
   - Look for cards that capture the theme's feeling
   - Include both obvious and subtle thematic matches
   - Think about the theme's core experience

Example 1 - "A deck about dreams and nightmares":
{
    "searchType": "semantic",
    "query": "legendary creature dream sleep nightmare illusion mind consciousness reality horror vision ethereal phantom",
    "options": {
        "searchComponents": ["name", "type", "abilities", "theme", "keywords"],
        "minSimilarity": 0.15,
        "colorIdentity": ["U", "B"],  // Blue for illusions, Black for nightmares
        "cardType": "Legendary Creature",
        "limit": 50
    }
}

Example 2 - "A deck about nature reclaiming civilization":
{
    "searchType": "semantic",
    "query": "legendary creature growth overgrowth reclaim nature wild primal ruin decay consume adapt evolve",
    "options": {
        "searchComponents": ["name", "type", "abilities", "theme", "keywords"],
        "minSimilarity": 0.15,
        "colorIdentity": ["G", "B"],  // Green for nature, Black for decay
        "cardType": "Legendary Creature",
        "limit": 50
    }
}

IMPORTANT NOTES:
1. Focus on the theme's essence rather than specific references
2. Consider both literal and metaphorical representations
3. Look for mechanics that feel like the theme
4. Use a wide range of related concepts and synonyms
5. Don't restrict colors unless they're essential to the theme

You must call the 'search_cards' function with your generated search parameters as a properly formatted JSON object. Do not provide any other text or explanation.`;

// This PRECURSOR_PROMPT is for PHASE 2 (Theming) - we'll use it later.
const PHASE_2_PRECURSOR_PROMPT = `You are an expert Magic: The Gathering card designer and lore master.
Your task is to take a provided list of existing Magic: The Gathering card names (the Commander and its supporting cards) and apply a user\'s specified theme.
For each non-land card, you must provide:
1.  The Original MTG Card Name (as provided).
2.  A new Themed Card Name fitting the user's theme.
3.  A concise Reasoning (1-2 sentences) for the thematic adaptation.
Basic lands will be handled separately and should not be part of this theming process.
Output ONLY the list of themed card entries. Each card entry (all three parts) must be on a new line, separated by ';;'.
Format: Original MTG Card Name;;Themed Card Name;;Reasoning
Example (Theme: "Steampunk Robots", Original Card: "Sol Ring"):
Sol Ring;;Aether-Cog Gyroscope;;Sol Ring provides mana acceleration. Reimagined as an \'Aether-Cog Gyroscope\', it fits the steampunk robot theme as a crucial cog in the mechanical workings of the deck, powering its contraptions.
`;

// Deck Parameters State
let deckParameters = {
    commander: null,
    customization: 'full',
    powerLevel: 'focused',
    budgetRange: 'moderate',
    additionalPreferences: '',
    theme: '',
    playstyle: '',
    deckConcept: '',
    allPotentialCommanders: []
};

// Add a variable to track the current analysis
let currentAnalysisPromise = null;

// Initialize deck parameters UI
function initializeDeckParameters(commander) {
    console.log('Initializing deck parameters for commander:', commander);
    
    // Store the commander
    deckParameters.commander = commander;
    
    // Display the commander in the deck parameters section
    const commanderDisplay = document.getElementById('deck-commander-display');
    if (!commanderDisplay) {
        console.error('Commander display container not found!');
        return;
    }
    
    const cardContainer = document.createElement('div');
    cardContainer.className = 'selected-commander-card';
    cardContainer.innerHTML = `
        <div class="card-image-container"></div>
        <div class="card-name">${commander.name}</div>
        <div class="card-type">${commander.type_line}</div>
    `;
    
    commanderDisplay.innerHTML = '';
    commanderDisplay.appendChild(cardContainer);
    displayCommanderCard(cardContainer, commander);

    // Show the deck parameters section
    const deckParametersSection = document.getElementById('deck-parameters');
    if (deckParametersSection) {
        deckParametersSection.style.display = 'block';
        // Scroll to the deck parameters section
        deckParametersSection.scrollIntoView({ behavior: 'smooth' });
    } else {
        console.error('Deck parameters section not found!');
    }
    
    // Initialize event listeners for the parameters
    initializeDeckParameterListeners();
}

// Initialize event listeners for deck parameters
function initializeDeckParameterListeners() {
    // Get all the parameter inputs
    const customizationLevel = document.getElementById('customization-level');
    const powerLevel = document.getElementById('power-level');
    const budgetRange = document.getElementById('budget-range');
    const additionalPreferences = document.getElementById('additional-preferences');
    const submitButton = document.getElementById('submit-parameters');

    // Update deck parameters when values change
    if (customizationLevel) {
        customizationLevel.addEventListener('change', (e) => {
            deckParameters.customization = e.target.value;
            console.log('Customization level updated:', deckParameters.customization);
        });
    }

    if (powerLevel) {
        powerLevel.addEventListener('change', (e) => {
            deckParameters.powerLevel = e.target.value;
            console.log('Power level updated:', deckParameters.powerLevel);
        });
    }

    if (budgetRange) {
        budgetRange.addEventListener('change', (e) => {
            deckParameters.budgetRange = e.target.value;
            console.log('Budget range updated:', deckParameters.budgetRange);
        });
    }

    if (additionalPreferences) {
        additionalPreferences.addEventListener('input', (e) => {
            deckParameters.additionalPreferences = e.target.value;
            console.log('Additional preferences updated:', deckParameters.additionalPreferences);
        });
    }

    // Handle deck generation when submit button is clicked
    if (submitButton) {
        submitButton.addEventListener('click', async () => {
            console.log('Generating deck with parameters:', deckParameters);
            await generateDeckWithGPT();
        });
    }
}

// Helper function to get card image URL
function getCardImageUrl(card) {
    console.log('Getting image URL for card:', card.name);
    console.log('Card image_uris:', card.image_uris);
    console.log('Card faces:', card.card_faces);

    // Handle double-faced cards
    if (card.card_faces && card.card_faces.length > 0) {
        return card.card_faces[0].image_uris?.normal;
    }

    // Handle single-faced cards
    if (card.image_uris) {
        if (card.image_uris.front?.normal) {
            return card.image_uris.front.normal;
        }
        if (card.image_uris.normal) {
            return card.image_uris.normal;
        }
    }

    console.warn('No image URL found for card:', card.name);
    return null;
}

// Update display functions to handle double-faced cards
function displayCommanderCard(cardElement, card) {
    const imageContainer = cardElement.querySelector('.card-image-container');
    if (!imageContainer) return;

    // Handle double-faced cards
    const isDoubleFaced = card.card_faces && card.card_faces.length > 0;
    let frontUrl, backUrl;

    if (isDoubleFaced) {
        frontUrl = card.card_faces[0].image_uris?.normal;
        backUrl = card.card_faces[1].image_uris?.normal;
    } else {
        frontUrl = card.image_uris?.front?.normal || card.image_uris?.normal;
    }

    if (!frontUrl) {
        console.error('No image URL available for card:', card.name);
        imageContainer.innerHTML = `<div class="no-image">No image available</div>`;
        return;
    }

    imageContainer.innerHTML = `
        <div class="card-image-wrapper">
            <img src="${frontUrl}" 
                 alt="${card.name}" 
                 class="card-image"
                 ${isDoubleFaced ? `data-front="${frontUrl}" data-back="${backUrl}"` : ''}>
            ${isDoubleFaced ? '<button class="flip-button">Flip</button>' : ''}
            <div class="card-image-overlay"></div>
        </div>
    `;

    // Add flip button handler for double-faced cards
    if (isDoubleFaced && backUrl) {
        const flipButton = imageContainer.querySelector('.flip-button');
        const img = imageContainer.querySelector('.card-image');
        let showingFront = true;

        flipButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering card selection
            if (showingFront) {
                img.src = backUrl;
                flipButton.textContent = 'Flip Back';
            } else {
                img.src = frontUrl;
                flipButton.textContent = 'Flip';
            }
            showingFront = !showingFront;
        });
    }
}

// Generate deck using GPT
async function generateDeckWithGPT() {
    const submitButton = document.getElementById('submit-parameters');
    submitButton.disabled = true;
    submitButton.textContent = 'Generating Deck...';

    try {
        // Prepare the prompt for GPT
        const prompt = `Generate a Commander deck based on the following parameters:
Commander: ${deckParameters.commander.name}
Deck Concept: ${deckParameters.deckConcept}
Customization Level: ${deckParameters.customization}
Power Level: ${deckParameters.powerLevel}
Budget Range: ${deckParameters.budgetRange}
Additional Preferences: ${deckParameters.additionalPreferences}

Please provide a deck list that includes:
1. Card names
2. Card types
3. Brief explanation of each card's role in the deck
4. Total deck cost
5. Mana curve analysis`;

        console.log('Sending deck generation request to GPT...');
        console.log('Parameters:', deckParameters);

        const response = await fetch(BACKEND_URL + '/api/generate-deck', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt,
                deckParameters
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`GPT API Error: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        console.log('GPT Response:', data);

        if (!data.choices || !data.choices[0]?.message?.content) {
            throw new Error('Invalid response from GPT');
        }

        // Parse the GPT response
        const deckData = JSON.parse(data.choices[0].message.content);
        console.log('Parsed deck data:', deckData);

        // Display the generated deck
        displayGeneratedDeck(deckData);

    } catch (error) {
        console.error('Error generating deck:', error);
        alert(`Error generating deck: ${error.message}\nPlease try again.`);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Generate Deck';
    }
}

// Display the generated deck
function displayGeneratedDeck(deckData) {
    // Create a new section for the deck display
    const deckDisplay = document.createElement('div');
    deckDisplay.id = 'generated-deck';
    deckDisplay.className = 'generated-deck';
    
    // Create the deck header
    deckDisplay.innerHTML = `
        <h2>${deckData.deckName}</h2>
        <div class="deck-stats">
            <div class="stat">
                <h3>Commander</h3>
                <p>${deckData.commander.name}</p>
                <p class="type">${deckData.commander.type}</p>
                <p class="role">${deckData.commander.role}</p>
            </div>
            <div class="stat">
                <h3>Total Cost</h3>
                <p>$${deckData.totalCost.toFixed(2)}</p>
            </div>
        </div>
        <div class="mana-curve">
            <h3>Mana Curve</h3>
            <div class="curve-chart">
                ${Object.entries(deckData.manaCurve).map(([cmc, count]) => `
                    <div class="curve-bar">
                        <div class="bar" style="height: ${count * 20}px"></div>
                        <span class="cmc">${cmc}</span>
                        <span class="count">${count}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="deck-list">
            <h3>Deck List</h3>
            <div class="cards">
                ${deckData.cards.map(card => `
                    <div class="card-entry">
                        <h4>${card.name}</h4>
                        <p class="type">${card.type}</p>
                        <p class="role">${card.role}</p>
                        <p class="synergy">${card.synergy}</p>
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="deck-analysis">
            <h3>Deck Analysis</h3>
            <p>${deckData.analysis}</p>
        </div>
    `;

    // Add the deck display to the page
    const resultsSection = document.getElementById('results-section');
    if (resultsSection) {
        // Remove any existing deck display
        const existingDeck = document.getElementById('generated-deck');
        if (existingDeck) {
            existingDeck.remove();
        }
        resultsSection.appendChild(deckDisplay);
        deckDisplay.scrollIntoView({ behavior: 'smooth' });
    }
}

// Update the selectCommander function
function selectCommander(card) {
    console.log('Commander selected:', card.name);
    
    // Remove selected class from all cards
    document.querySelectorAll('.commander-option').forEach(el => {
        el.classList.remove('selected-commander');
    });
    
    // Add selected class to the chosen card
    const selectedCard = Array.from(document.querySelectorAll('.commander-option'))
        .find(el => el.querySelector('img').alt === card.name);
    if (selectedCard) {
        selectedCard.classList.add('selected-commander');
    }
    
    // Enable the Next Step button
    const nextStepButton = document.getElementById('next-step-commander');
    if (nextStepButton) {
        nextStepButton.disabled = false;
        nextStepButton.textContent = 'Analyze Commander';
        nextStepButton.classList.add('active');
    }

    // Store the selected commander for later use
    deckParameters.commander = card;
}

// Add this new function before showCommanderAnalysis
function convertManaCostToSymbols(text) {
    if (!text) return text;
    return text.replace(/\{([^}]+)\}/g, (match, symbol) => {
        // Explicit mapping for color symbols
        const colorMap = {
            'W': 'w', 'U': 'u', 'B': 'b', 'R': 'r', 'G': 'g', 'C': 'c',
            'w': 'w', 'u': 'u', 'b': 'b', 'r': 'r', 'g': 'g', 'c': 'c'
        };
        if (colorMap[symbol]) {
            return `<img src=\"https://svgs.scryfall.com/card-symbols/${colorMap[symbol]}.svg\" alt=\"{${symbol}}\" class=\"mana-symbol\" title=\"{${symbol}}\">`;
        }
        let code = symbol.toLowerCase()
            .replace(/\//g, '')
            .replace('∞', 'infinity')
            .replace('½', 'half')
            .replace(/\s+/g, '');
        // Special handling for tap/untap
        if (symbol.toUpperCase() === 'T') code = 'tap';
        if (symbol.toUpperCase() === 'Q') code = 'untap';
        return `<img src=\"https://svgs.scryfall.com/card-symbols/${code}.svg\" alt=\"{${symbol}}\" class=\"mana-symbol\" title=\"{${symbol}}\">`;
    });
}

// Update the ability display in showCommanderAnalysis
async function showCommanderAnalysis(commander) {
    console.log('Starting analysis for:', commander.name);
    
    // Cancel any ongoing analysis
    if (currentAnalysisPromise) {
        console.log('Cancelling previous analysis');
        currentAnalysisPromise = null;
    }

    // Keep the results section visible and show loading state
    const resultsSection = document.getElementById('results-section');
    const analysisSection = document.getElementById('commander-analysis-section');
    const nextStepButton = document.getElementById('next-step-commander');
    
    if (nextStepButton) {
        nextStepButton.disabled = true;
        nextStepButton.innerHTML = '<div class="loading-spinner"></div> Analyzing...';
        nextStepButton.classList.add('loading');
    }
    
    try {
        console.log('Starting API calls for analysis');
        // Only get commander analysis (no custom name reasoning)
        currentAnalysisPromise = Promise.all([
            getCommanderAnalysis(commander)
        ]);

        // Wait for the analysis to complete
        const [analysisResult] = await currentAnalysisPromise;
        console.log('Analysis completed for:', commander.name);
        
        // Only proceed if this is still the current analysis
        if (currentAnalysisPromise) {
            console.log('Updating UI with analysis results');
            
            // Now hide results and show analysis section
            resultsSection.style.display = 'none';
            analysisSection.style.display = 'block';
            
            // Display the commander card
            const cardDisplay = analysisSection.querySelector('.commander-card-display');
            cardDisplay.innerHTML = '<div class="card-image-container"></div>';
            displayCommanderCard(cardDisplay, commander);
            
            // Initialize focus options
            initializeFocusOptions();
            
            // Initialize action buttons
            initializeAnalysisActions(commander);
            
            // Update the Next Step button
            if (nextStepButton) {
                nextStepButton.disabled = false;
                nextStepButton.textContent = 'Next Step!';
                nextStepButton.classList.remove('loading');
                nextStepButton.classList.add('active');
            }
        }
    } catch (error) {
        console.error('Error during analysis:', error);
        // Only show error if this is still the current analysis
        if (currentAnalysisPromise) {
            // Keep the results section visible
            resultsSection.style.display = 'block';
            analysisSection.style.display = 'none';
            
            // Update the Next Step button to error state
            if (nextStepButton) {
                nextStepButton.disabled = false;
                nextStepButton.textContent = 'Error - Try Again';
                nextStepButton.classList.remove('loading');
                nextStepButton.classList.add('error');
            }
        }
    }
}

// Update getCommanderAnalysis to call OpenAI through backend
async function getCommanderAnalysis(commander) {
    console.log('Getting commander analysis for:', commander.name);
    const analysisDiv = document.getElementById('commander-analysis');
    if (!analysisDiv) return;
    
    try {
        // Format commander details, handling double-faced cards
        const getCardDetails = (card) => {
            let details = [];
            
            // Handle double-faced cards
            if (card.card_faces && card.card_faces.length > 0) {
                card.card_faces.forEach((face, index) => {
                    details.push(`Face ${index + 1}:`);
                    details.push(`Name: ${face.name}`);
                    details.push(`Type: ${face.type_line || ''}`);
                    if (face.mana_cost) details.push(`Mana Cost: ${face.mana_cost}`);
                    if (face.power && face.toughness) details.push(`Power/Toughness: ${face.power}/${face.toughness}`);
                    if (face.oracle_text) details.push(`Oracle Text:\n${face.oracle_text}`);
                    details.push(''); // Add blank line between faces
                });
            } else {
                details.push(`Name: ${card.name}`);
                details.push(`Type: ${card.type_line || ''}`);
                if (card.mana_cost) details.push(`Mana Cost: ${card.mana_cost}`);
                if (card.power && card.toughness) details.push(`Power/Toughness: ${card.power}/${card.toughness}`);
                if (card.oracle_text) details.push(`Oracle Text:\n${card.oracle_text}`);
            }
            
            // Add general card information
            details.push(`Color Identity: ${card.color_identity.join(', ')}`);
            if (card.keywords && card.keywords.length > 0) {
                details.push(`Keywords: ${card.keywords.join(', ')}`);
            }
            if (card.edhrec_rank) {
                details.push(`EDHREC Rank: ${card.edhrec_rank}`);
            }
            
            return details.join('\n');
        };

        const systemPrompt = `You are an expert Magic: The Gathering Commander deck analyst. 
Analyze the provided commander card and provide insights about its strengths, weaknesses, and potential deck building strategies.
Focus specifically on how well this commander aligns with the user's deck concept and desired strategy.

Important Context:
- You will be provided with the selected commander and a list of other potential commanders that matched the search
- Consider how this commander compares to the alternatives for the user's strategy
- Explain why this commander might be better or worse than similar alternatives for the specific deck concept
- For double-faced commanders, consider both faces in your analysis
- Consider the commander's EDHREC rank when evaluating its popularity and proven effectiveness

Structure your analysis in these sections:
1. Theme Alignment - How well does this commander fit the user's desired theme/concept?
2. Strategy Analysis - How can this commander execute the desired strategy?
3. Strengths - What are the commander's key strengths for this concept?
4. Challenges - What potential challenges might arise with this theme?
5. Alternatives Analysis - How does this commander compare to similar options?
6. Key Cards/Synergies - Suggest some key cards or synergies that would work well.`;
        
        // Get all potential commanders that were found
        const allCommanders = deckParameters.allPotentialCommanders || [];
        const similarCommanders = allCommanders
            .filter(c => c.card.name !== commander.name)
            .slice(0, 10); // Get top 10 alternatives

        const userPrompt = `Analyze this commander for the following deck concept:
"${deckParameters.deckConcept}"

Selected Commander Details:
${getCardDetails(commander)}

Similar Commanders Found (for comparison):
${similarCommanders.map(c => {
    const card = c.card;
    return `- ${card.name} (${card.type_line})\n  ${card.oracle_text ? card.oracle_text.split('\n')[0] : ''}`
}).join('\n')}

Consider these additional parameters:
Theme: ${deckParameters.theme}
Playstyle: ${deckParameters.playstyle}
Customization: ${deckParameters.customization}
Power Level: ${deckParameters.powerLevel}
Budget Range: ${deckParameters.budgetRange}
Additional Preferences: ${deckParameters.additionalPreferences}

Please provide a detailed analysis focusing on how this commander can fulfill the user's desired deck concept and strategy.
Compare it to the similar commanders listed above when relevant to explain why this might or might not be the best choice.
For double-faced commanders, explain how both faces contribute to the strategy.`;

        console.log('Getting commander analysis with deck concept:', deckParameters.deckConcept);
        console.log('Commander details being sent:', getCardDetails(commander));
        
        const response = await fetch(BACKEND_URL + '/api/analyze-commander', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                systemPrompt,
                userPrompt
            })
        });

        if (!response.ok) {
            throw new Error('Failed to analyze commander');
        }

        const data = await response.json();
        const analysis = data.choices[0].message.content;
        
        // Format the analysis with sections
        const formattedAnalysis = analysis
            .replace(/Theme Alignment:/g, '<h4 class="analysis-section">Theme Alignment:</h4>')
            .replace(/Strategy Analysis:/g, '<h4 class="analysis-section">Strategy Analysis:</h4>')
            .replace(/Strengths:/g, '<h4 class="analysis-section">Strengths:</h4>')
            .replace(/Challenges:/g, '<h4 class="analysis-section">Challenges:</h4>')
            .replace(/Alternatives Analysis:/g, '<h4 class="analysis-section">Alternatives Analysis:</h4>')
            .replace(/Key Cards\/Synergies:/g, '<h4 class="analysis-section">Key Cards/Synergies:</h4>')
            .replace(/\n/g, '<br>');
            
        analysisDiv.innerHTML = formattedAnalysis;
        return analysis;
    } catch (error) {
        console.error('Error in getCommanderAnalysis:', error);
        analysisDiv.innerHTML = 'Error analyzing commander. Please try again.';
        throw error;
    }
}

// Update generateCustomNameReasoning to call OpenAI through backend
async function generateCustomNameReasoning(commander) {
    const nameReasoning = document.querySelector('.name-reasoning');
    nameReasoning.innerHTML = '<div class="loading">Generating name suggestions...</div>';
    
    try {
        const systemPrompt = `You are a creative Magic: The Gathering card designer. Generate thematic name suggestions for the provided commander card based on the user's theme and playstyle.`;
        
        const userPrompt = `Generate thematic name suggestions for this commander:
Name: ${commander.name}
Type: ${commander.type_line}
Theme: ${deckParameters.theme}
Playstyle: ${deckParameters.playstyle}

Provide 3 creative name suggestions that blend the commander's mechanics with the user's theme.`;

        console.log('Generating custom name suggestions for:', commander.name);
        const response = await fetch(BACKEND_URL + '/api/generate-name-suggestions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                systemPrompt,
                userPrompt
            })
        });

        if (!response.ok) {
            throw new Error('Failed to generate custom name reasoning');
        }

        const data = await response.json();
        const reasoning = data.choices[0].message.content;
        nameReasoning.innerHTML = reasoning;
        
    } catch (error) {
        console.error('Error generating custom name reasoning:', error);
        nameReasoning.innerHTML = '<div class="error">Failed to generate name suggestions.</div>';
    }
}

// New function to initialize focus options
function initializeFocusOptions() {
    const focusOptions = document.querySelectorAll('.focus-option');
    const customStrategyInput = document.querySelector('.custom-strategy-input');
    
    focusOptions.forEach(option => {
        option.addEventListener('click', () => {
            // Remove selected class from all options
            focusOptions.forEach(opt => opt.classList.remove('selected'));
            // Add selected class to clicked option
            option.classList.add('selected');
            
            // Show/hide custom strategy input
            if (option.dataset.focus === 'custom') {
                customStrategyInput.style.display = 'block';
            } else {
                customStrategyInput.style.display = 'none';
            }
        });
    });
}

// New function to initialize analysis action buttons
function initializeAnalysisActions(commander) {
    const proceedButton = document.getElementById('proceed-to-deck');
    const adjustButton = document.getElementById('adjust-parameters');
    
    proceedButton.addEventListener('click', () => {
        // Get the selected focus
        const selectedFocus = document.querySelector('.focus-option.selected');
        const focus = selectedFocus ? selectedFocus.dataset.focus : null;
        
        // Get custom strategy if applicable
        const customStrategy = focus === 'custom' ? 
            document.getElementById('custom-strategy').value : null;
        
        // Get custom name if provided
        const customName = document.getElementById('custom-commander-name').value;
        
        // Update deck parameters
        deckParameters.commander = commander;
        deckParameters.focus = focus;
        deckParameters.customStrategy = customStrategy;
        if (customName) {
            deckParameters.customCommanderName = customName;
        }
        
        // Hide analysis section and show deck parameters
        document.getElementById('commander-analysis-section').style.display = 'none';
        initializeDeckParameters(commander);
    });
    
    adjustButton.addEventListener('click', () => {
        // Hide analysis section and show results section
        document.getElementById('commander-analysis-section').style.display = 'none';
        document.getElementById('results-section').style.display = 'block';
    });
}

// Add a card to the grid
function addCardToGrid(card) {
    const cardList = document.getElementById('card-list');
    const cardRow = document.createElement('div');
    cardRow.className = 'card-row';
    cardRow.dataset.cardId = card.id;

    // Calculate card price
    const price = card.prices?.usd || card.prices?.usd_foil || 0;
    deckParameters.currentBudget += parseFloat(price);

    cardRow.innerHTML = `
        <div class="card-cell">${card.name}</div>
        <div class="card-cell">
            <input type="text" class="custom-name-input" 
                   value="${card.name}" 
                   ${deckParameters.customization === 'standard' ? 'disabled' : ''}>
        </div>
        <div class="card-cell">
            <label class="art-toggle">
                <input type="checkbox" 
                       ${deckParameters.customization === 'standard' ? 'disabled' : ''}>
                <span class="art-toggle-slider"></span>
            </label>
        </div>
        <div class="card-cell">$${price}</div>
        <div class="card-cell">${card.type_line}</div>
        <div class="card-cell card-actions">
            <button class="action-button" onclick="removeCard('${card.id}')">Remove</button>
            <button class="action-button" onclick="showCardDetails('${card.id}')">Details</button>
        </div>
    `;

    cardList.appendChild(cardRow);
    updateBudgetDisplay();
}

// Remove a card from the grid
function removeCard(cardId) {
    const cardRow = document.querySelector(`.card-row[data-card-id="${cardId}"]`);
    if (cardRow) {
        const price = parseFloat(cardRow.querySelector('.card-cell:nth-child(4)').textContent.replace('$', ''));
        deckParameters.currentBudget -= price;
        cardRow.remove();
        updateBudgetDisplay();
    }
}

// Update budget display
function updateBudgetDisplay() {
    const budgetDisplay = document.getElementById('current-budget');
    budgetDisplay.textContent = `Current Total: $${deckParameters.currentBudget.toFixed(2)}`;
    
    // Check if over budget
    if (deckParameters.maxBudget && deckParameters.currentBudget > deckParameters.maxBudget) {
        budgetDisplay.style.color = '#ff4444';
    } else {
        budgetDisplay.style.color = '#fff';
    }
}

// Update deck grid based on parameters
function updateDeckGrid() {
    const customNameInputs = document.querySelectorAll('.custom-name-input');
    const artToggles = document.querySelectorAll('.art-toggle input');
    
    customNameInputs.forEach(input => {
        input.disabled = deckParameters.customization === 'standard';
    });
    
    artToggles.forEach(toggle => {
        toggle.disabled = deckParameters.customization === 'standard';
    });
}

// Show card details
function showCardDetails(cardId) {
    // Implement card details modal/popup
    console.log('Show details for card:', cardId);
}

// Initialize deck building after commander selection
function initializeDeckBuilding() {
    document.getElementById('deck-parameters').style.display = 'block';
    document.getElementById('deck-grid').style.display = 'block';
    initializeDeckParameters();
}

async function getAIScryfallQuery(deckConcept) {
    console.log("Getting AI search parameters for deck concept:", deckConcept);
    
    const userPromptText = `User's Deck Concept: ${deckConcept}

Please analyze this deck concept and generate appropriate search parameters to find commanders that match the theme and strategy described.
Use the hybrid search type to combine semantic and text-based searching.
Set a lower similarity threshold (0.1-0.3) to get more potential matches.
Include partial matches and search across all relevant components.
Return ONLY the JSON object with the search parameters.`;

    try {
        const response = await fetch(`${BACKEND_URL}/api/generate-search-parameters`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                systemPrompt: `You are an expert at crafting search queries for a Magic: The Gathering card database.
Your task is to generate search parameters that will find potential commander options for a given deck concept.

IMPORTANT GUIDELINES:
1. Use the "hybrid" search type to combine semantic and text-based searching
2. Set minSimilarity to 0.15-0.25 to get more potential matches
3. Include ALL relevant search components
4. Enable includePartialMatches for broader results
5. Set a high limit (50-100) to get more options
6. Only specify colorIdentity if explicitly mentioned or crucial to theme
7. Break down complex themes into key mechanical and thematic elements

Example format:
{
    "searchType": "hybrid",
    "query": "your search text",
    "options": {
        "searchComponents": ["name", "type", "abilities", "oracle_text", "flavor_text", "keywords"],
        "minSimilarity": 0.2,
        "limit": 50,
        "includePartialMatches": true
    }
}`,
                userPrompt: userPromptText,
                tools: [CARD_SEARCH_TOOL_DEFINITION],
                toolChoice: { type: "function", function: { name: "search_cards" } },
                maxTokens: 1000,
                temperature: 0.2
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('API Error (Phase 1):', response.status, errorData);
            throw new Error(`Error from API (Phase 1): ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        console.log('API Success (Phase 1):', data);

        if (data.choices && data.choices[0].message && data.choices[0].message.tool_calls) {
            const toolCall = data.choices[0].message.tool_calls[0];
            if (toolCall.function.name === "search_cards") {
                try {
                    let argsStr = toolCall.function.arguments;
                    console.log('Raw arguments:', argsStr);
                    
                    // Clean up the JSON string
                    argsStr = argsStr.replace(/\/\/.*$/gm, '');
                    argsStr = argsStr.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
                    
                    const searchParams = JSON.parse(argsStr);
                    console.log('Parsed search parameters:', searchParams);
                    
                    // Ensure required fields and defaults
                    if (!searchParams.searchType || !searchParams.query) {
                        throw new Error('Invalid search parameters: missing required fields');
                    }
                    
                    searchParams.options = searchParams.options || {};
                    searchParams.options.searchComponents = searchParams.options.searchComponents || 
                        ["name", "type", "abilities", "oracle_text", "flavor_text", "keywords"];
                    searchParams.options.minSimilarity = searchParams.options.minSimilarity || 0.2;
                    searchParams.options.limit = searchParams.options.limit || 50;
                    searchParams.options.includePartialMatches = true;
                    
                    return searchParams;
                    
                } catch (parseError) {
                    console.error("Error parsing search parameters:", parseError);
                    console.error("Raw arguments:", toolCall.function.arguments);
                    throw new Error(`Failed to parse search parameters: ${parseError.message}`);
                }
            }
        }
        throw new Error('Invalid response format from API');
    } catch (error) {
        console.error('Error getting search parameters:', error);
        throw error;
    }
}

async function searchCardsInDatabase(searchParams) {
    console.log("Searching cards in database with params:", searchParams);
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/cards/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(searchParams)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: response.statusText }));
            console.error('Card Search API Error:', response.status, errorData);
            throw new Error(errorData.error || `Server returned ${response.status}`);
        }

        const data = await response.json();
        console.log('Card Search API Success:', data);

        if (data && data.length > 0) {
            // Store all results for analysis
            const allResults = data.map(result => ({
                ...result,
                card: {
                    ...result.card,
                    similarity: result.similarity,
                    oracle_text: result.card.oracle_text || '',
                    type_line: result.card.type_line || '',
                    mana_cost: result.card.mana_cost || '',
                    cmc: result.card.cmc || 0,
                    color_identity: result.card.color_identity || [],
                    keywords: result.card.keywords || [],
                    power: result.card.power,
                    toughness: result.card.toughness,
                    legalities: result.card.legalities || {},
                    edhrec_rank: result.card.edhrec_rank,
                    card_faces: result.card.card_faces || null
                }
            }));

            // Take top 10 results for GPT analysis
            const top10Results = allResults.slice(0, 10);

            // Log the exact data being sent to GPT with similarity score explanation
            console.log('\nData being sent to GPT for analysis - Top 10 Commanders:');
            console.log('\nNOTE: Similarity Scores are calculated as follows:');
            console.log('Base Score: Average of semantic similarity across components (name, type, abilities, etc.)');
            console.log('Boosts applied:');
            console.log('- Legendary Status: +0.2');
            console.log('- Color Identity Match: +0.15');
            console.log('- Theme Word Match: +0.2');
            console.log('- Keyword Match: +0.15');
            console.log('- Tribal Type Match: +0.25');
            console.log('- Tribal Reference: +0.125');
            console.log('\nFinal score is base score plus applicable boosts.');
            console.log('Scores above 0.6 typically indicate strong matches with multiple boosts.\n');

            top10Results.forEach((result, index) => {
                const card = result.card;
                console.log(`\n${index + 1}. ${card.name} (Similarity Score: ${result.similarity.toFixed(3)})`);
                console.log(`Type: ${card.type_line}`);
                console.log(`Mana Cost: ${card.mana_cost || 'N/A'}`);
                console.log(`Color Identity: ${card.color_identity.join(',')}`);
                console.log(`Oracle Text: ${card.oracle_text || 'N/A'}`);
                if (card.power) console.log(`Power/Toughness: ${card.power}/${card.toughness}`);
                if (card.keywords.length > 0) console.log(`Keywords: ${card.keywords.join(', ')}`);
                if (card.edhrec_rank) console.log(`EDHREC Rank: ${card.edhrec_rank}`);
                
                // Add match explanation
                console.log('Match Analysis:');
                if (result.similarity > 0.6) {
                    console.log('- Strong match with multiple boost factors');
                } else if (result.similarity > 0.4) {
                    console.log('- Moderate match with some boost factors');
                } else {
                    console.log('- Base similarity match with few or no boosts');
                }
            });

            // Send top 10 to GPT for analysis
            const analysisResponse = await fetch(`${BACKEND_URL}/api/analyze-top-commanders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    commanders: top10Results.map(result => result.card),
                    deckConcept: deckParameters.deckConcept
                })
            });

            if (!analysisResponse.ok) {
                throw new Error('Failed to analyze potential commanders');
            }

            const analysisData = await analysisResponse.json();
            const analysis = analysisData.choices[0].message.content;
            console.log('GPT Analysis:', analysis);

            // Store the full analysis explanation
            deckParameters.initialAnalysis = analysis.split('\n').slice(1).join('\n');

            if (analysis.startsWith('SEARCH:')) {
                // Extract the new search query
                const newQuery = analysis.split('\n')[0].replace('SEARCH:', '').trim();
                const explanation = analysis.split('\n').slice(1).join('\n');
                throw new Error(`Need to refine search: ${explanation}\nNew Query: ${newQuery}`);
            }

            if (analysis.startsWith('SELECTED:')) {
                // Extract the selected indices and verify exactly 5 were selected
                const selectedIndices = analysis
                    .split('\n')[0]
                    .replace('SELECTED:', '')
                    .trim()
                    .split(',')
                    .map(num => parseInt(num.trim()) - 1) // Convert to 0-based indices
                    .filter(num => !isNaN(num));

                if (selectedIndices.length !== 5) {
                    console.error('GPT did not select exactly 5 commanders:', selectedIndices);
                    throw new Error('GPT did not select exactly 5 commanders. Requesting new analysis.');
                }

                // Validate indices are within bounds
                if (selectedIndices.some(index => index < 0 || index >= top10Results.length)) {
                    console.error('GPT selected invalid commander indices:', selectedIndices);
                    throw new Error('Invalid commander indices selected. Requesting new analysis.');
                }

                // Get the selected commanders in the specified order
                const selectedCommanders = selectedIndices.map(index => top10Results[index]);

                // Store all results for later use
                deckParameters.allPotentialCommanders = allResults;

                // Return the selected commanders
                return selectedCommanders.map(result => {
                    const card = result.card;
                    return {
                        name: card.name,
                        type_line: card.type_line,
                        oracle_text: card.oracle_text,
                        mana_cost: card.mana_cost,
                        cmc: card.cmc,
                        color_identity: card.color_identity,
                        keywords: card.keywords,
                        power: card.power,
                        toughness: card.toughness,
                        rarity: card.rarity,
                        image_uris: card.image_uris,
                        similarity: result.similarity,
                        legalities: card.legalities,
                        edhrec_rank: card.edhrec_rank,
                        card_faces: card.card_faces
                    };
                });
            }

            throw new Error('Invalid analysis response from GPT');
        } else {
            console.log("No cards found or unexpected response:", data);
            return [];
        }
    } catch (error) {
        console.error('Error searching cards in database:', error);
        throw error;
    }
}

// Update the fetchCardsFromScryfall function to handle the search parameters correctly
async function fetchCardsFromScryfall(searchParams) {
    console.log("Fetching cards with search parameters:", searchParams);
    
    try {
        // If searchParams is a string, it's the old format - convert to new format
        if (typeof searchParams === 'string') {
            searchParams = {
                searchType: 'semantic',
                query: searchParams,
                options: {
                    searchComponents: ['name', 'type', 'abilities'],
                    minSimilarity: 0.7,
                    limit: 70
                }
            };
        }

        // Validate search parameters
        if (!searchParams.searchType || !searchParams.query) {
            throw new Error('Invalid search parameters: missing searchType or query');
        }

        // Search the local database
        const cards = await searchCardsInDatabase(searchParams);
        
        if (!cards || cards.length === 0) {
            console.log("No cards found in the database for the search parameters.");
            return [];
        }

        console.log(`Found ${cards.length} cards in the database`);
        return cards;

    } catch (error) {
        console.error('Error fetching cards:', error);
        throw error;
    }
}

async function getCustomizedDeck(fetchedCards, deckConcept) {
    const cardListForPrompt = fetchedCards.map(card => `${card.name} (Type: ${card.type_line})`).join('\n');

    const fullPromptForPhase2 = `${PHASE_2_PRECURSOR_PROMPT}\n\nUser's Deck Concept: ${deckConcept}\n\nHere is the list of ${fetchedCards.length} non-land cards fetched from Scryfall. Please provide customized names and reasoning for each as requested:\n${cardListForPrompt}\n\nBegin card list (Original Name;;Custom Name;;Reasoning):`;

    console.log("Sending Phase 2 prompt for customization...");

    try {
        const response = await fetch(`${BACKEND_URL}/api/generate-themed-deck`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fullPromptForPhase2,
                cardListForPrompt
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('API Error (Phase 2):', response.status, errorData);
            alert(`Error from API (Phase 2): ${errorData.error?.message || response.statusText}`);
            return null;
        }

        const data = await response.json();
        console.log('API Success (Phase 2):', data);

        if (data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
            const customizedDeckText = data.choices[0].message.content.trim();
            return customizedDeckText;
        } else {
            console.error('No valid response structure from API (Phase 2):', data);
            alert('Received an unexpected response format during customization.');
            return null;
        }

    } catch (error) {
        console.error('Error calling API (Phase 2):', error);
        alert(`An error occurred while trying to customize the deck: ${error.message}`);
        return null;
    }
}

function parseCustomizedData(customizedDeckString) {
    if (!customizedDeckString || typeof customizedDeckString !== 'string') {
        console.error("Invalid customized deck string for parsing.");
        return [];
    }
    const lines = customizedDeckString.trim().split('\n');
    const parsedCards = lines.map((line, index) => {
        const parts = line.split(';;');
        if (parts.length >= 3) {
            return {
                id: index + 1,
                originalName: parts[0].trim(),
                customName: parts[1].trim(),
                reasoning: parts[2].trim(),
                isCommander: index === 0,
                isLand: false
            };
        } else {
            console.warn(`Skipping malformed line during parsing (line ${index + 1}): ${line}`);
            return null;
        }
    }).filter(card => card !== null);
    return parsedCards;
}

function displayDeckList(deckArray, targetDivId) {
    const cardListDiv = document.getElementById(targetDivId);
    if (!cardListDiv) {
        console.error(`Target div with id '${targetDivId}' not found for displaying deck list.`);
        return;
    }

    cardListDiv.innerHTML = ''; // Clear previous content (like raw data or loading messages)

    if (!deckArray || deckArray.length === 0) {
        cardListDiv.innerHTML = "<p>No deck data to display.</p>";
        return;
    }

    const table = document.createElement('table');
    table.className = 'deck-table'; // For styling

    // Create table header
    const thead = table.createTHead();
    const headerRow = thead.insertRow();
    const headers = ['#', 'Role', 'Original MTG Name', 'Themed Name', 'Reasoning/Link'];
    headers.forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        headerRow.appendChild(th);
    });

    // Create table body
    const tbody = table.createTBody();
    deckArray.forEach(card => {
        const row = tbody.insertRow();
        row.insertCell().textContent = card.id;
        row.insertCell().textContent = card.isCommander ? 'Commander' : (card.isLand ? 'Land' : 'Spell');
        row.insertCell().textContent = card.originalName;
        row.insertCell().textContent = card.themedName;
        row.insertCell().textContent = card.reasoning;
        if (card.isCommander) {
            row.classList.add('commander-row'); // For special styling
        }
        if (card.isLand) {
            row.classList.add('land-row');
        }
    });

    cardListDiv.appendChild(table);

    // Placeholder for filter/sort controls - to be added above the table
    const controlsDiv = document.createElement('div');
    controlsDiv.id = 'deck-controls';
    controlsDiv.innerHTML = `<p><em>Filter and sort controls will go here.</em></p>`;
    cardListDiv.insertBefore(controlsDiv, table);

    // Add total card count
    const countP = document.createElement('p');
    countP.textContent = `Total cards: ${deckArray.length}`;
    cardListDiv.appendChild(countP);
}

// Add new function for secondary commander analysis
async function getSecondaryCommanderAnalysis(commanders) {
    console.log('Getting secondary analysis for commanders:', commanders);
    
    const systemPrompt = `You are an expert Magic: The Gathering Commander deck analyst.
Your task is to analyze these top commander options and provide a strategic recommendation.
Consider their synergies, unique abilities, and how they align with the user's deck concept.
You should also suggest potential interactions between these commanders and recommend the best choice.`;

    const userPrompt = `Analyze these top commander options for the deck concept: "${deckParameters.deckConcept}"

Commander Details:
${commanders.map((card, index) => `
${index + 1}. ${card.name}
Type: ${card.type_line}
Mana Cost: ${card.mana_cost || 'N/A'}
Color Identity: ${card.color_identity.join(',')}
Oracle Text: ${card.oracle_text || 'N/A'}
${card.power ? `Power/Toughness: ${card.power}/${card.toughness}` : ''}
${card.keywords.length > 0 ? `Keywords: ${card.keywords.join(', ')}` : ''}
`).join('\n')}

Please provide:
1. A comparison of their strengths and weaknesses
2. How they might interact with each other in the 99
3. Which commander would be the strongest lead for this concept
4. Potential alternative strategies with each commander
5. Any interesting card combinations specific to each commander`;

    try {
        const response = await fetch(`${BACKEND_URL}/api/analyze-commanders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                commanders,
                deckConcept: deckParameters.deckConcept,
                systemPrompt,
                userPrompt
            })
        });

        if (!response.ok) {
            throw new Error('Failed to get secondary analysis');
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('Error in secondary commander analysis:', error);
        throw error;
    }
}

// Modify displayCommanderOptions function to add secondary analysis button
function displayCommanderOptions(cards) {
    console.log('Displaying commander options for cards:', cards);
    
    // Ensure results section is visible
    const resultsSection = document.getElementById('results-section');
    const results = document.getElementById('results');
    if (resultsSection) {
        resultsSection.style.display = 'block';
    }
    if (results) {
        results.style.display = 'block';
    }
    
    const container = document.getElementById('commander-options');
    if (!container) {
        console.error('Commander options container not found!');
        return;
    }
    
    // Clear previous content
    container.innerHTML = '';

    // Add initial analysis section if available
    if (deckParameters.initialAnalysis) {
        const analysisSection = document.createElement('div');
        analysisSection.className = 'initial-analysis';
        analysisSection.innerHTML = `
            <h3>Initial Commander Analysis</h3>
            <div class="analysis-content">
                ${deckParameters.initialAnalysis.replace(/\n/g, '<br>')}
            </div>
        `;
        container.appendChild(analysisSection);
    }
    
    // Create container for commander cards
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'commander-cards-container';
    container.appendChild(cardsContainer);
    
    // Get the Next Step button
    const nextStepButton = document.getElementById('next-step-commander');
    if (nextStepButton) {
        // Disable the Next Step button initially
        nextStepButton.disabled = true;
        nextStepButton.textContent = 'Select a Commander';
        nextStepButton.classList.remove('active');

        // Add event listener for the Next Step button
        nextStepButton.addEventListener('click', () => {
            const selectedCard = document.querySelector('.commander-option.selected-commander');
            if (selectedCard) {
                const cardName = selectedCard.querySelector('.card-name').textContent;
                const selectedCommander = cards.find(card => card.name === cardName);
                if (selectedCommander) {
                    // Update button to loading state
                    nextStepButton.disabled = true;
                    nextStepButton.innerHTML = '<div class="loading-spinner"></div> Analyzing...';
                    nextStepButton.classList.add('loading');
                    // Start the analysis
                    showCommanderAnalysis(selectedCommander);
                }
            }
        });
    }
    
    if (!cards || cards.length === 0) {
        throw new Error('No commanders found matching your deck concept. Try adjusting your description.');
    }
    
    cards.forEach(card => {
        console.log('Processing card:', card.name);
        console.log('Card image_uris:', card.image_uris);
        
        const cardElement = document.createElement('div');
        cardElement.className = 'commander-option';
        
        cardElement.innerHTML = `
            <div class="card-image-container"></div>
            <div class="card-name">${card.name}</div>
            <div class="card-type">${card.type_line || ''}</div>
            <div class="card-details">
                <div class="card-text">${card.oracle_text || ''}</div>
                ${card.power ? `<div class="card-stats">Power/Toughness: ${card.power}/${card.toughness}</div>` : ''}
                ${card.keywords.length > 0 ? `<div class="card-keywords">Keywords: ${card.keywords.join(', ')}</div>` : ''}
            </div>
        `;
        
        displayCommanderCard(cardElement, card);
        
        // Add click handler
        cardElement.addEventListener('click', () => {
            document.querySelectorAll('.commander-option').forEach(opt => opt.classList.remove('selected-commander'));
            cardElement.classList.add('selected-commander');
            selectCommander(card);
        });
        
        cardsContainer.appendChild(cardElement);
    });

    // Add secondary analysis button after the commander cards
    const analysisButtonContainer = document.createElement('div');
    analysisButtonContainer.className = 'secondary-analysis-container';
    analysisButtonContainer.innerHTML = `
        <button id="secondary-analysis-btn" class="secondary-button">
            Get Detailed Comparison
        </button>
        <div id="secondary-analysis-result" class="secondary-analysis-result" style="display: none;"></div>
    `;
    container.appendChild(analysisButtonContainer);

    // Add click handler for secondary analysis button
    const analysisButton = document.getElementById('secondary-analysis-btn');
    analysisButton.addEventListener('click', async () => {
        try {
            // Update button state
            analysisButton.disabled = true;
            analysisButton.innerHTML = '<div class="loading-spinner"></div> Analyzing...';

            // Get the analysis
            const analysis = await getSecondaryCommanderAnalysis(cards);

            // Display the analysis
            const resultDiv = document.getElementById('secondary-analysis-result');
            resultDiv.innerHTML = analysis.replace(/\n/g, '<br>');
            resultDiv.style.display = 'block';

            // Update button
            analysisButton.innerHTML = 'Analysis Complete';
            analysisButton.classList.add('complete');
        } catch (error) {
            console.error('Error getting secondary analysis:', error);
            analysisButton.innerHTML = 'Analysis Failed - Try Again';
            analysisButton.classList.add('error');
            analysisButton.disabled = false;
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('MTG AI Deck Builder script loaded.');

    const deckConceptForm = document.getElementById('deck-theme-form');
    const resultsSection = document.getElementById('results-section');
    const results = document.getElementById('results');
    const commanderOptions = document.getElementById('commander-options');

    if (!deckConceptForm) {
        console.error('Deck concept form not found!');
        return;
    }

    deckConceptForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('Form submitted');
        
        const deckConcept = document.getElementById('deck-concept').value;
        console.log('Deck concept from form:', deckConcept);
        
        // Store deck concept in deckParameters
        deckParameters.deckConcept = deckConcept;
        
        // Show loading state
        if (resultsSection) {
            resultsSection.style.display = 'block';
        }
        if (results) {
            results.style.display = 'block';
        }
        if (commanderOptions) {
            commanderOptions.innerHTML = '<div class="loading-placeholder">Finding potential commanders...<br>This may take a few moments.</div>';
        }

        try {
            // Get search parameters from GPT
            const searchParams = await getAIScryfallQuery(deckConcept);
            if (!searchParams) {
                throw new Error('Failed to generate search parameters. Please try again with a different description.');
            }

            let retryCount = 0;
            const maxRetries = 3;
            let cards = null;

            while (retryCount < maxRetries) {
                try {
                    console.log('Fetching commander options...');
                    cards = await searchCardsInDatabase(searchParams);
                    break; // If successful, exit the loop
                } catch (error) {
                    if (error.message.startsWith('Need to refine search:')) {
                        retryCount++;
                        if (retryCount >= maxRetries) {
                            throw new Error('Unable to find suitable commanders after multiple attempts. Please try refining your deck concept.');
                        }

                        // Extract the new search query if provided
                        const newQueryMatch = error.message.match(/New Query: (.*?)(?:\n|$)/);
                        const explanation = error.message.replace('Need to refine search:', '').replace(/\nNew Query:.*$/, '').trim();

                        if (newQueryMatch) {
                            // Use the GPT-provided search query
                            searchParams.query = newQueryMatch[1].trim();
                            console.log('Using GPT-provided search query:', searchParams.query);
                        } else {
                            // Get new search parameters with the explanation
                            const newParams = await getAIScryfallQuery(deckConcept + '\n\nPrevious search issue: ' + explanation);
                            if (!newParams) {
                                throw new Error('Failed to generate new search parameters.');
                            }
                            Object.assign(searchParams, newParams);
                        }
                        continue;
                    }
                    throw error; // Re-throw if it's not a retry-search error
                }
            }

            if (!cards || cards.length === 0) {
                throw new Error('No commanders found matching your deck concept. Try adjusting your description with more specific themes or mechanics.');
            }

            console.log('Displaying commander options...');
            displayCommanderOptions(cards);

        } catch (error) {
            console.error('Error finding commanders:', error);
            if (commanderOptions) {
                // Create a more user-friendly error message
                let errorMessage = error.message;
                if (errorMessage.includes('JSON')) {
                    errorMessage = 'There was an issue processing your request. Please try again with a different description.';
                } else if (errorMessage.includes('API')) {
                    errorMessage = 'The server is temporarily unavailable. Please try again in a few moments.';
                }
                
                commanderOptions.innerHTML = `
                    <div class="error">
                        <h3>Error Finding Commanders</h3>
                        <p>${errorMessage}</p>
                        <p class="error-suggestion">Try:</p>
                        <ul class="error-tips">
                            <li>Using more specific descriptions of your deck's theme</li>
                            <li>Mentioning specific mechanics or strategies you want to use</li>
                            <li>Including color preferences if you have any</li>
                            <li>Describing the playstyle you're aiming for</li>
                        </ul>
                    </div>`;
            }
            
            // Re-enable the form
            const submitButton = document.querySelector('.find-commander-btn');
            if (submitButton) {
                submitButton.disabled = false;
            }
        }
    });
});

// We will also need some CSS for the table. 
