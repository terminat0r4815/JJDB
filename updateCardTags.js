const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class RateLimiter {
    constructor(maxRequests = 10, timeWindow = 1000) {
        this.maxRequests = maxRequests;
        this.timeWindow = timeWindow;
        this.requests = [];
    }

    async waitForSlot() {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.timeWindow);
        
        if (this.requests.length >= this.maxRequests) {
            const oldestRequest = this.requests[0];
            const waitTime = this.timeWindow - (now - oldestRequest);
            if (waitTime > 0) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        
        this.requests.push(now);
    }
}

class TagUpdater {
    constructor() {
        this.cardsDir = path.join(__dirname, 'card_data');
        this.rateLimiter = new RateLimiter(10, 1000); // 10 requests per second
        this.processedCards = 0;
        this.totalCards = 0;
        this.errors = [];
    }

    async fetchCardTags(cardId) {
        try {
            await this.rateLimiter.waitForSlot();
            
            const response = await axios.get(`https://api.scryfall.com/cards/${cardId}/tagger-tags`, {
                headers: {
                    'User-Agent': 'MTG-AI-Builder/1.0 (Testing)'
                }
            });

            // Organize tags by category
            const categorizedTags = {
                art: [],
                mechanics: [],
                themes: [],
                colors: [],
                tribal: [],
                other: []
            };

            if (response.data.data) {
                response.data.data.forEach(tag => {
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

            return categorizedTags;
        } catch (error) {
            console.error(`Error fetching tags for card ${cardId}:`, error.message);
            this.errors.push({ cardId, error: error.message });
            return null;
        }
    }

    async processCardFile(filePath) {
        try {
            const data = await fs.readFile(filePath, 'utf8');
            const card = JSON.parse(data);
            
            console.log(`Processing card: ${card.name} (${card.id})`);
            
            // Fetch tags using the card's Scryfall ID
            const tags = await this.fetchCardTags(card.id);
            if (tags) {
                // Update card data with tags
                card.tags = tags;
                
                // Save updated card data
                await fs.writeFile(filePath, JSON.stringify(card, null, 2));
                this.processedCards++;
                console.log(`Successfully updated ${card.name}`);
            }
            
            // Add small delay between cards
            await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
            console.error(`Error processing file ${filePath}:`, error.message);
            this.errors.push({ file: filePath, error: error.message });
        }
    }

    async updateAllCards() {
        try {
            console.log('Starting card tag update process...');
            
            // Process all color identity directories
            const colorDirs = await fs.readdir(this.cardsDir);
            
            for (const colorDir of colorDirs) {
                if (colorDir === 'progress.json') continue;
                
                const colorPath = path.join(this.cardsDir, colorDir);
                const typeDirs = await fs.readdir(colorPath);
                
                for (const typeDir of typeDirs) {
                    const typePath = path.join(colorPath, typeDir);
                    const files = await fs.readdir(typePath);
                    
                    // Count total cards
                    this.totalCards += files.filter(f => f.endsWith('.json')).length;
                    
                    // Process each card file
                    for (const file of files) {
                        if (file.endsWith('.json')) {
                            const filePath = path.join(typePath, file);
                            await this.processCardFile(filePath);
                            
                            // Log progress
                            if (this.processedCards % 10 === 0) {
                                console.log(`Progress: ${this.processedCards}/${this.totalCards} cards processed`);
                            }
                        }
                    }
                }
            }
            
            // Log final results
            console.log('\nTag update process completed:');
            console.log(`Total cards processed: ${this.processedCards}/${this.totalCards}`);
            console.log(`Errors encountered: ${this.errors.length}`);
            
            if (this.errors.length > 0) {
                console.log('\nErrors:');
                this.errors.forEach(error => {
                    if (error.cardId) {
                        console.log(`- ${error.cardId}: ${error.error}`);
                    } else {
                        console.log(`- ${error.file}: ${error.error}`);
                    }
                });
            }
            
        } catch (error) {
            console.error('Error updating card tags:', error.message);
            throw error;
        }
    }
}

// Run the update process
const updater = new TagUpdater();
updater.updateAllCards().catch(console.error); 