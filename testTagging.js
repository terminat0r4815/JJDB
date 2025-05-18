const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Test configuration
const TEST_CARDS = [
    {
        name: "Lathliss, Dragon Queen",
        set: "m19",
        collector_number: "149"
    },
    {
        name: "Karrthus, Tyrant of Jund",
        set: "arb",
        collector_number: "117"
    }
];

async function getCardIdentifier(cardName) {
    try {
        console.log(`\nFetching Scryfall ID for card: ${cardName}`);
        const response = await axios.get(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`, {
            headers: {
                'User-Agent': 'MTG-AI-Builder/1.0 (Testing)'
            }
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching card data for ${cardName}:`, error.message);
        return null;
    }
}

async function testTagAPI(cardData) {
    try {
        // First get the Scryfall ID
        const card = await getCardIdentifier(cardData.name);
        if (!card) {
            console.error('Could not find card:', cardData.name);
            return null;
        }

        console.log(`\nTesting tag API for card: ${card.name} (${card.id})`);
        const response = await axios.get(`https://api.scryfall.com/cards/${card.id}/tagger-tags`, {
            headers: {
                'User-Agent': 'MTG-AI-Builder/1.0 (Testing)'
            }
        });

        console.log('\nAPI Response Structure:');
        console.log(JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (error) {
        console.error('Error fetching tags:', error.message);
        if (error.response) {
            console.error('API Error Response:', error.response.data);
        }
        return null;
    }
}

async function examineCurrentCardData() {
    try {
        console.log('\nExamining current card data structure...');
        
        // Read a sample card from card_data directory
        const cardDataDir = path.join(__dirname, 'card_data');
        const dirs = await fs.readdir(cardDataDir);
        
        // Get first color identity directory
        const colorDir = path.join(cardDataDir, dirs[0]);
        const typesDirs = await fs.readdir(colorDir);
        
        // Get first type directory
        const typeDir = path.join(colorDir, typesDirs[0]);
        const files = await fs.readdir(typeDir);
        
        // Read first card file
        const cardFile = path.join(typeDir, files[0]);
        const cardData = JSON.parse(await fs.readFile(cardFile, 'utf8'));
        
        console.log('\nCurrent Card Data Structure:');
        console.log(JSON.stringify(cardData, null, 2));
        
        return cardData;
    } catch (error) {
        console.error('Error examining card data:', error.message);
        return null;
    }
}

async function demonstrateIntegration(cardData, tagData) {
    if (!cardData || !tagData) {
        console.log('Missing data for integration demonstration');
        return;
    }

    console.log('\nDemonstrating tag integration...');

    // Create categorized tag structure
    const categorizedTags = {
        art: [],
        mechanics: [],
        themes: [],
        colors: [],
        tribal: [],
        other: []
    };

    // Categorize tags
    if (tagData.data) {
        tagData.data.forEach(tag => {
            const tagType = tag.type || 'other';
            switch(tagType) {
                case 'art':
                    categorizedTags.art.push(tag.text);
                    break;
                case 'mechanic':
                    categorizedTags.mechanics.push(tag.text);
                    break;
                case 'theme':
                    categorizedTags.themes.push(tag.text);
                    break;
                case 'color':
                    categorizedTags.colors.push(tag.text);
                    break;
                case 'tribal':
                    categorizedTags.tribal.push(tag.text);
                    break;
                default:
                    categorizedTags.other.push(tag.text);
            }
        });
    }

    // Create integrated card data structure
    const integratedCard = {
        ...cardData,
        tags: categorizedTags
    };

    console.log('\nProposed Integrated Card Structure:');
    console.log(JSON.stringify(integratedCard, null, 2));

    // Analyze changes
    console.log('\nAnalysis of Changes:');
    console.log('1. Original card data size:', JSON.stringify(cardData).length, 'bytes');
    console.log('2. Integrated card data size:', JSON.stringify(integratedCard).length, 'bytes');
    console.log('3. New fields added:', Object.keys(categorizedTags).join(', '));
    
    // Show example search improvements
    console.log('\nPotential Search Improvements:');
    if (categorizedTags.themes.length > 0) {
        console.log('- Theme tags for better thematic searches:', categorizedTags.themes);
    }
    if (categorizedTags.mechanics.length > 0) {
        console.log('- Mechanics tags for strategy matching:', categorizedTags.mechanics);
    }
    if (categorizedTags.tribal.length > 0) {
        console.log('- Tribal tags for tribe detection:', categorizedTags.tribal);
    }
}

// Test script execution
async function runTests() {
    console.log('Starting tag integration tests...');

    // Test 1: Examine current data structure
    const currentCardData = await examineCurrentCardData();
    
    // Test 2: Test tag API
    for (const card of TEST_CARDS) {
        const tagData = await testTagAPI(card);
        if (tagData && currentCardData) {
            await demonstrateIntegration(currentCardData, tagData);
        }
        // Add delay between API calls
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

// Run the tests
runTests().catch(console.error); 