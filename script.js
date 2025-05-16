// JavaScript for MTG AI Deck Builder will go here

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const SCRYFALL_API_BASE_URL = 'https://api.scryfall.com';

// const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // Removed: Not used for actual API calls from client
// const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'; // Removed: Not used for actual API calls from client

// Add API key validation
function validateApiKey() {
    if (!window.CONFIG || !window.CONFIG.OPENAI_API_KEY) {
        console.error('OpenAI API key is not set in CONFIG');
        alert('OpenAI API key is not configured. Please check your setup.');
        return false;
    }
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
                    enum: ["semantic", "oracle"],
                    description: "Type of search to perform: 'semantic' for multi-dimensional search or 'oracle' for specific text search"
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
                                enum: ["name", "type", "abilities"]
                            },
                            description: "Components to search in (for semantic search only)"
                        },
                        minSimilarity: {
                            type: "number",
                            minimum: 0,
                            maximum: 1,
                            description: "Minimum similarity threshold (0.5-0.8 recommended)"
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
                            oneOf: [
                                {
                                    type: "string",
                                    description: "Single card type to filter by"
                                },
                                {
                                    type: "array",
                                    items: {
                                        type: "string"
                                    },
                                    description: "Multiple card types to filter by"
                                }
                            ],
                            description: "Filter by card type(s)"
                        },
                        cmc: {
                            type: "number",
                            description: "Filter by converted mana cost"
                        },
                        rarity: {
                            type: "string",
                            enum: ["common", "uncommon", "rare", "mythic"],
                            description: "Filter by rarity"
                        },
                        limit: {
                            type: "number",
                            description: "Maximum number of results to return"
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
Your primary task is to understand the user's desired deck theme and playstyle, and then formulate an effective search query to find a suitable commander.

IMPORTANT: You MUST return a properly formatted JSON object with the following structure:
{
    "searchType": "semantic",
    "query": "your search text",
    "options": {
        "searchComponents": ["name", "type", "abilities"],
        "minSimilarity": 0.3,
        "colorIdentity": ["W", "U", "B", "R", "G"],
        "cardType": "Legendary",
        "limit": 20
    }
}

When formulating the search query, prioritize in this order:
1. PRIMARY: Playstyle - Focus on abilities and effects that support the desired playstyle
2. PRIMARY: Color Identity - Use the colors specified by the user. If no colors are specified, choose colors that best enable the playstyle
3. SECONDARY: Theme - Only incorporate theme-related terms if they naturally fit with the card's text or flavor

IMPORTANT: Your search query MUST:
- Start with "legendary" to ensure we get legendary permanents
- Include "creature" if you want to focus on creature commanders
- Include any relevant permanent types (e.g., "legendary planeswalker" for planeswalker commanders)
- Focus on abilities that support the playstyle
- Include color identity terms only if not already specified in options

For example, if the user wants:
- Theme: "Steampunk Robots"
- Playstyle: "Control"
- Colors: "Red and Blue"

Your search query should focus on:
1. Control-oriented abilities and effects
2. Red and Blue colors (as specified by user)
3. Only include artifact/mechanical terms if they naturally fit with control effects

Example search query for above:
{
    "searchType": "semantic",
    "query": "legendary permanent with control abilities",
    "options": {
        "searchComponents": ["name", "type", "abilities"],
        "minSimilarity": 0.3,
        "colorIdentity": ["U", "R"],  // Red and Blue as specified by user
        "cardType": "Legendary",
        "limit": 20
    }
}

The search should aim to find:
- A legendary permanent that enables the desired playstyle
- A legendary permanent with the user's specified colors (or appropriate colors if none specified)
- A legendary permanent that can incidentally support the theme if possible

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
    playstyle: ''
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
    
    const imageUrl = getCardImageUrl(commander);
    console.log('Commander image URL:', imageUrl);
    
    commanderDisplay.innerHTML = `
        <div class="selected-commander-card">
            <div class="card-image-container">
                <img src="${imageUrl}" 
                     alt="${commander.name}" 
                     class="card-image"
                     onerror="this.onerror=null; console.error('Failed to load image for ${commander.name}'); this.src='https://c1.scryfall.com/file/scryfall-card-backs/large/59/597b79b3-7d77-4261-871a-60dd17403388.jpg?1562638020'">
                ${commander.image_uris?.isDoubleFaced ? '<button class="flip-button">Flip</button>' : ''}
            </div>
            <div class="card-name">${commander.name}</div>
            <div class="card-type">${commander.type_line}</div>
        </div>
    `;

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

    if (!card || !card.image_uris) {
        console.warn('Card or image_uris is missing:', card);
        return 'https://c1.scryfall.com/file/scryfall-card-backs/large/59/597b79b3-7d77-4261-871a-60dd17403388.jpg?1562638020';
    }

    // Get the front image URL
    const frontUrl = card.image_uris.front?.normal;
    if (!frontUrl) {
        console.warn('No front image URL found for card:', card.name);
        return 'https://c1.scryfall.com/file/scryfall-card-backs/large/59/597b79b3-7d77-4261-871a-60dd17403388.jpg?1562638020';
    }

    console.log('Using image URL:', frontUrl);
    return frontUrl;
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

        const response = await fetch('https://jjdb.onrender.com/api/generate-deck', {
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
    
    // Update Next Step button to loading state
    const nextStepButton = document.getElementById('next-step-commander');
    if (nextStepButton) {
        console.log('Updating button to loading state');
        nextStepButton.disabled = true;
        nextStepButton.innerHTML = '<div class="loading-spinner"></div> Analyzing...';
        nextStepButton.classList.add('loading');
        
        // Start the analysis immediately
        showCommanderAnalysis(card);
    }
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
            return `<img src=\"https://svgs.scryfall.io/card-symbols/${colorMap[symbol]}.svg\" alt=\"{${symbol}}\" class=\"mana-symbol\" title=\"{${symbol}}\">`;
        }
        let code = symbol.toLowerCase()
            .replace(/\//g, '')
            .replace('∞', 'infinity')
            .replace('½', 'half')
            .replace(/\s+/g, '');
        // Special handling for tap/untap
        if (symbol.toUpperCase() === 'T') code = 'tap';
        if (symbol.toUpperCase() === 'Q') code = 'untap';
        return `<img src=\"https://svgs.scryfall.io/card-symbols/${code}.svg\" alt=\"{${symbol}}\" class=\"mana-symbol\" title=\"{${symbol}}\">`;
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
        // Create a new analysis promise
        currentAnalysisPromise = Promise.all([
            getCommanderAnalysis(commander),
            generateCustomNameReasoning(commander)
        ]);

        // Wait for the analysis to complete
        const [analysisResult, nameReasoningResult] = await currentAnalysisPromise;
        console.log('Analysis completed for:', commander.name);
        
        // Only proceed if this is still the current analysis
        if (currentAnalysisPromise) {
            console.log('Updating UI with analysis results');
            
            // Now hide results and show analysis section
            resultsSection.style.display = 'none';
            analysisSection.style.display = 'block';
            
            // Display the commander card
            const cardDisplay = analysisSection.querySelector('.commander-card-display');
            const imageUrl = getCardImageUrl(commander);
            cardDisplay.innerHTML = `
                <div class="card-image-container">
                    <img src="${imageUrl}" 
                         alt="${commander.name}" 
                         class="card-image"
                         onerror="this.onerror=null; this.src='https://c1.scryfall.com/file/scryfall-card-backs/large/59/597b79b3-7d77-4261-871a-60dd17403388.jpg?1562638020'">
                </div>
            `;
            
            // Display commander details
            analysisSection.querySelector('.commander-name').textContent = commander.name;
            analysisSection.querySelector('.commander-type').textContent = commander.type_line;
            
            // Format oracle text with proper line breaks and styling (no bullet points)
            const abilitiesText = commander.oracle_text || 'No abilities';
            const formattedAbilities = abilitiesText
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .join('\n');
            // Convert mana costs and tap/untap to symbols before displaying
            const abilitiesWithSymbols = convertManaCostToSymbols(formattedAbilities);
            
            analysisSection.querySelector('.commander-abilities').innerHTML = abilitiesWithSymbols
                .split('\n')
                .map(line => `<div class=\"ability-line\">${line}</div>`)
                .join('');
            
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

// Update getCommanderAnalysis to call OpenAI directly
async function getCommanderAnalysis(commander) {
    if (!validateApiKey()) return null;
    
    console.log('Getting commander analysis for:', commander.name);
    const analysisDiv = document.getElementById('commander-analysis');
    if (!analysisDiv) return;
    
    try {
        const systemPrompt = `You are an expert Magic: The Gathering Commander deck analyst. Analyze the provided commander card and provide insights about its strengths, weaknesses, and potential deck building strategies.`;
        
        const userPrompt = `Analyze this commander:
Name: ${commander.name}
Type: ${commander.type_line}
Oracle Text: ${commander.oracle_text}
Mana Cost: ${commander.mana_cost}
Color Identity: ${commander.color_identity.join(', ')}

Consider the following parameters:
Theme: ${deckParameters.theme}
Playstyle: ${deckParameters.playstyle}
Customization: ${deckParameters.customization}
Power Level: ${deckParameters.powerLevel}
Budget Range: ${deckParameters.budgetRange}
Additional Preferences: ${deckParameters.additionalPreferences}`;

        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.CONFIG.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                max_tokens: 1000,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            throw new Error('Failed to analyze commander');
        }

        const data = await response.json();
        const analysis = data.choices[0].message.content;
        analysisDiv.innerHTML = analysis.replace(/\n/g, '<br>');
        return analysis;
    } catch (error) {
        console.error('Error in getCommanderAnalysis:', error);
        analysisDiv.innerHTML = 'Error analyzing commander. Please try again.';
        throw error;
    }
}

// Update generateCustomNameReasoning to call OpenAI directly
async function generateCustomNameReasoning(commander) {
    if (!validateApiKey()) return;

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

        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.CONFIG.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                max_tokens: 500,
                temperature: 0.8
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

async function getAIScryfallQuery(theme, playstyle) {
    if (!validateApiKey()) return null;

    const userQueryContent = `User's Preferred Theme: ${theme}\nUser's Playstyle/Deck Type: ${playstyle}`;

    console.log("Sending Phase 1 prompt to OpenAI to generate search parameters...");
    console.log("System Prompt:", PHASE_1_SYSTEM_PROMPT);
    console.log("User Content:", userQueryContent);

    try {
        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.CONFIG.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages: [
                    { role: "system", content: PHASE_1_SYSTEM_PROMPT },
                    { role: "user", content: userQueryContent }
                ],
                tools: [CARD_SEARCH_TOOL_DEFINITION],
                tool_choice: { type: "function", function: { name: "search_cards" } },
                max_tokens: 500,
                temperature: 0.2
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('OpenAI API Error (Phase 1):', response.status, errorData);
            alert(`Error from OpenAI API (Phase 1): ${errorData.error?.message || response.statusText}`);
            return null;
        }

        const data = await response.json();
        console.log('OpenAI API Success (Phase 1):', data);

        if (data.choices && data.choices[0].message && data.choices[0].message.tool_calls) {
            const toolCall = data.choices[0].message.tool_calls[0];
            if (toolCall.function.name === "search_cards") {
                const searchParams = JSON.parse(toolCall.function.arguments);
                console.log("AI generated search parameters:", searchParams);
                return searchParams;
            } else {
                console.error("AI called an unexpected tool:", toolCall.function.name);
                alert("AI responded with an unexpected tool call for search parameter generation.");
                return null;
            }
        } else {
            console.error('No valid tool_calls structure from OpenAI:', data);
            alert('Received an unexpected response format from OpenAI when expecting search parameters.');
            return null;
        }

    } catch (error) {
        console.error('Error calling OpenAI API (Phase 1):', error);
        alert(`An error occurred while trying to contact OpenAI API: ${error.message}`);
        return null;
    }
}

async function searchCardsInDatabase(searchParams) {
    console.log("Searching cards in database with params:", searchParams);
    
    try {
        const response = await fetch('/api/cards/search', {
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

        // Return only the top 5 matches for commander selection
        if (data && data.length > 0) {
            return data.slice(0, 5).map(result => {
                const card = result.card;
                console.log('Raw card data:', card);
                console.log('Card image_uris:', card.image_uris);
                console.log('Card card_faces:', card.card_faces);
                
                // The server already processes image_uris, so we can use it directly
                const processedCard = {
                    name: card.name,
                    type_line: card.type_line,
                    oracle_text: card.oracle_text,
                    mana_cost: card.mana_cost,
                    cmc: card.cmc,
                    color_identity: card.color_identity,
                    rarity: card.rarity,
                    image_uris: card.image_uris,
                    similarity: result.similarity
                };
                console.log('Processed card data:', processedCard);
                return processedCard;
            });
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

async function getAIThemedDeck(fetchedCards, theme, playstyle) {
    if (!validateApiKey()) return null;

    const cardListForPrompt = fetchedCards.map(card => `${card.name} (Type: ${card.type_line})`).join('\n');

    const fullPromptForPhase2 = `${PHASE_2_PRECURSOR_PROMPT}\n\nUser's Original Theme: ${theme}\nUser's Original Playstyle: ${playstyle}\n\nHere is the list of ${fetchedCards.length} non-land cards fetched from Scryfall. Please provide the themed name and reasoning for each as requested:\n${cardListForPrompt}\n\nBegin themed card list (Original Name;;Themed Name;;Reasoning):`;

    console.log("Sending Phase 2 prompt to OpenAI for theming...");

    try {
        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.CONFIG.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages: [
                    { role: "user", content: fullPromptForPhase2 }
                ],
                max_tokens: 1500,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('OpenAI API Error (Phase 2 Theming):', response.status, errorData);
            alert(`Error from OpenAI API (Phase 2 Theming): ${errorData.error?.message || response.statusText}`);
            return null;
        }

        const data = await response.json();
        console.log('OpenAI API Success (Phase 2 Theming):', data);

        if (data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
            const themedCardDataText = data.choices[0].message.content.trim();
            return themedCardDataText;
        } else {
            console.error('No valid response structure from OpenAI (Phase 2 Theming):', data);
            alert('Received an unexpected response format from OpenAI during theming.');
            return null;
        }

    } catch (error) {
        console.error('Error calling OpenAI API (Phase 2 Theming):', error);
        alert(`An error occurred while trying to contact OpenAI API for theming: ${error.message}`);
        return null;
    }
}

function parseThemedData(themedDeckDataString) {
    if (!themedDeckDataString || typeof themedDeckDataString !== 'string') {
        console.error("Invalid themedDeckDataString for parsing.");
        return [];
    }
    const lines = themedDeckDataString.trim().split('\n');
    const parsedCards = lines.map((line, index) => {
        const parts = line.split(';;');
        if (parts.length >= 3) {
            return {
                id: index + 1, // Line number
                originalName: parts[0].trim(),
                themedName: parts[1].trim(),
                reasoning: parts[2].trim(),
                isCommander: index === 0, // Assume first card is commander for now
                isLand: false // Initially all are non-lands from AI
            };
        } else {
            console.warn(`Skipping malformed line during parsing (line ${index + 1}): ${line}`);
            return null; // Or some error object
        }
    }).filter(card => card !== null); // Remove any null entries from malformed lines
    return parsedCards;
}

function addBasicLands(deckArray, numberOfLands = 33) { // Defaulting to 33 lands (approx 100 - 70 + 3)
    const landTypes = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
    let currentId = deckArray.length > 0 ? Math.max(...deckArray.map(c => c.id)) + 1 : 1;
    
    // Simple distribution for now, can be made smarter based on Commander colors
    for (let i = 0; i < numberOfLands; i++) {
        deckArray.push({
            id: currentId++,
            originalName: `Basic Land - ${landTypes[i % landTypes.length]}`, // Cycle through land types
            themedName: "N/A",
            reasoning: "N/A",
            isCommander: false,
            isLand: true
        });
    }
    return deckArray;
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
                    showCommanderAnalysis(selectedCommander);
                }
            }
        });
    }
    
    cards.forEach(card => {
        console.log('Processing card:', card.name);
        const imageUrl = getCardImageUrl(card);
        console.log('Image URL for', card.name, ':', imageUrl);
        
        const cardElement = document.createElement('div');
        cardElement.className = 'commander-option';
        
        // Create the card HTML structure
        cardElement.innerHTML = `
            <div class="card-image-container">
                <img src="${imageUrl}" 
                     alt="${card.name}" 
                     class="card-image"
                     onerror="this.onerror=null; console.error('Failed to load image for ${card.name}'); this.src='https://c1.scryfall.com/file/scryfall-card-backs/large/59/597b79b3-7d77-4261-871a-60dd17403388.jpg?1562638020'">
                ${card.image_uris?.isDoubleFaced ? '<button class="flip-button">Flip</button>' : ''}
            </div>
            <div class="card-name">${card.name}</div>
            <div class="card-type">${card.type_line || ''}</div>
        `;
        
        // Add click handler
        cardElement.addEventListener('click', () => {
            document.querySelectorAll('.commander-option').forEach(opt => opt.classList.remove('selected'));
            cardElement.classList.add('selected');
            selectCommander(card);
        });
        
        // Add flip button handler for double-faced cards
        if (card.image_uris?.isDoubleFaced) {
            const flipButton = cardElement.querySelector('.flip-button');
            const img = cardElement.querySelector('.card-image');
            
            flipButton.addEventListener('click', (e) => {
                e.stopPropagation();
                if (img.src === card.image_uris.front.normal) {
                    img.src = card.image_uris.back.normal;
                } else {
                    img.src = card.image_uris.front.normal;
                }
            });
        }
        
        container.appendChild(cardElement);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('MTG AI Deck Builder script loaded.');

    const deckThemeForm = document.getElementById('deck-theme-form');
    const resultsSection = document.getElementById('results-section');
    const results = document.getElementById('results');
    const commanderOptions = document.getElementById('commander-options');

    if (!deckThemeForm) {
        console.error('Deck theme form not found!');
        return;
    }

    deckThemeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('Form submitted');
        
        const theme = document.getElementById('preferred-theme').value;
        const playstyle = document.getElementById('playstyle').value;
        
        // Store theme and playstyle in deckParameters
        deckParameters.theme = theme;
        deckParameters.playstyle = playstyle;
        
        console.log('Stored deck parameters:', deckParameters);
        
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
            console.log('Getting AI search parameters...');
            const searchParams = await getAIScryfallQuery(theme, playstyle);
            if (!searchParams) {
                throw new Error('Failed to generate search parameters. Please try again.');
            }

            console.log('Fetching commander options...');
            const cards = await searchCardsInDatabase(searchParams);
            if (!cards || cards.length === 0) {
                throw new Error('No commanders found matching the criteria. Try adjusting your theme or playstyle.');
            }

            console.log('Displaying commander options...');
            displayCommanderOptions(cards);

        } catch (error) {
            console.error('Error finding commanders:', error);
            if (commanderOptions) {
                commanderOptions.innerHTML = `
                    <div class="error">
                        <h3>Error Finding Commanders</h3>
                        <p>${error.message}</p>
                        <p>Please try again or adjust your theme/playstyle.</p>
                    </div>`;
            }
        }
    });
});

// We will also need some CSS for the table. 