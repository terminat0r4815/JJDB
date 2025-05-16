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
        
        // Remove old requests outside the time window
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

class Logger {
    constructor(options = {}) {
        this.logFile = options.logFile || path.join(__dirname, 'logs', 'card_fetch.log');
        this.consoleOutput = options.consoleOutput !== false;
        this.logLevel = options.logLevel || 'info';
        this.logLevels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
    }

    async log(level, message, data = null) {
        if (this.logLevels[level] > this.logLevels[this.logLevel]) {
            return;
        }

        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            data
        };

        if (this.consoleOutput) {
            const consoleMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
            if (data) {
                console.log(consoleMessage, data);
            } else {
                console.log(consoleMessage);
            }
        }

        try {
            await fs.mkdir(path.dirname(this.logFile), { recursive: true });
            await fs.appendFile(this.logFile, JSON.stringify(logEntry) + '\n');
        } catch (error) {
            console.error('Error writing to log file:', error);
        }
    }

    async error(message, data = null) {
        await this.log('error', message, data);
    }

    async warn(message, data = null) {
        await this.log('warn', message, data);
    }

    async info(message, data = null) {
        await this.log('info', message, data);
    }

    async debug(message, data = null) {
        await this.log('debug', message, data);
    }
}

class CardEmbeddingService {
    constructor() {
        this.cards = new Map();
        this.initialized = false;
        this.vectorDimension = 300; // Dimension for our embeddings
        this.retryDelay = 2000; // Increased base delay for retries in ms
        this.maxRetries = 5; // Increased maximum number of retries
        this.cardsDir = path.join(__dirname, 'card_data');
        this.rateLimiter = new RateLimiter(10, 1000); // 10 requests per second
        this.logger = new Logger({
            logFile: path.join(__dirname, 'logs', 'card_fetch.log'),
            logLevel: process.env.LOG_LEVEL || 'info'
        });
        
        // Add caching with concurrency control
        this.cache = new Map();
        this.cacheTimeout = 3600000; // 1 hour cache timeout
        this.cacheLocks = new Map();
        this.initializationPromise = null;
    }

    // Add concurrency-safe initialization
    async initialize() {
        // If already initializing, wait for that to complete
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        // If already initialized, return immediately
        if (this.initialized) {
            return;
        }

        // Create initialization promise
        this.initializationPromise = (async () => {
            try {
                // Try to load existing data first
                try {
                    await this.loadFromFiles();
                    await this.logger.info(`Loaded ${this.cards.size} cards from files`);
                    this.initialized = true;
                    return;
                } catch (error) {
                    await this.logger.info('No existing card data found, fetching from Scryfall...');
                }
                
                // If loading from files fails, fetch from Scryfall
                await this.loadCardData();
                
                // Save the fetched data
                await this.saveToFiles();
                
                this.initialized = true;
            } finally {
                // Clear initialization promise
                this.initializationPromise = null;
            }
        })();

        return this.initializationPromise;
    }

    getCardPath(card) {
        // Get color identity string (e.g., "WUBRG", "WU", "C" for colorless)
        const colorIdentity = card.color_identity.length > 0 
            ? card.color_identity.join('') 
            : 'C';

        // Get primary card type (e.g., "Creature", "Instant", "Artifact")
        const primaryType = card.type_line.split(' — ')[0].split(' ')[0];

        // Create directory structure: card_data/COLORS/TYPE/
        const dirPath = path.join(this.cardsDir, colorIdentity, primaryType);
        
        // Create filename from card name (sanitized)
        const safeName = card.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const filename = `${safeName}_${card.id}.json`;
        
        return {
            dirPath,
            filePath: path.join(dirPath, filename)
        };
    }

    async saveToFiles() {
        try {
            console.log('Saving card data to files...');
            
            // Create directory if it doesn't exist
            await fs.mkdir(this.cardsDir, { recursive: true });
            
            // Group cards by color identity and type
            const cardGroups = new Map();
            
            this.cards.forEach(card => {
                const colorIdentity = card.color_identity.join('') || 'colorless';
                const type = card.type_line.split(' — ')[0].toLowerCase();
                
                if (!cardGroups.has(colorIdentity)) {
                    cardGroups.set(colorIdentity, new Map());
                }
                
                const typeMap = cardGroups.get(colorIdentity);
                if (!typeMap.has(type)) {
                    typeMap.set(type, []);
                }
                
                typeMap.get(type).push(card);
            });
            
            // Save each group to a separate file
            for (const [colorIdentity, typeMap] of cardGroups) {
                const colorDir = path.join(this.cardsDir, colorIdentity);
                await fs.mkdir(colorDir, { recursive: true });
                
                for (const [type, cards] of typeMap) {
                    const typeDir = path.join(colorDir, type);
                    await fs.mkdir(typeDir, { recursive: true });
                    
                    // Save each card to a separate file
                    for (const card of cards) {
                        const filePath = path.join(typeDir, `${card.id}.json`);
                        await fs.writeFile(filePath, JSON.stringify(card, null, 2));
                    }
                }
            }
            
            console.log('Card data saved successfully');
            
        } catch (error) {
            console.error('Error saving card data:', error.message);
            throw error;
        }
    }

    async loadFromFiles() {
        try {
            console.log('Loading card data from files...');
            
            // Check if directory exists
            try {
                await fs.access(this.cardsDir);
            } catch {
                throw new Error('Card data directory not found');
            }
            
            // Load all color identity directories
            const colorDirs = await fs.readdir(this.cardsDir);
            
            for (const colorDir of colorDirs) {
                const colorPath = path.join(this.cardsDir, colorDir);
                const typeDirs = await fs.readdir(colorPath);
                
                for (const typeDir of typeDirs) {
                    const typePath = path.join(colorPath, typeDir);
                    const files = await fs.readdir(typePath);
                    
                    for (const file of files) {
                        if (file.endsWith('.json')) {
                            const filePath = path.join(typePath, file);
                            const data = await fs.readFile(filePath, 'utf8');
                            const card = JSON.parse(data);
                            
                            // Ensure we have the complete card data
                            if (!card.image_uris && card.card_faces && card.card_faces.length > 0) {
                                card.image_uris = {
                                    isDoubleFaced: true,
                                    front: card.card_faces[0].image_uris,
                                    back: card.card_faces[1].image_uris
                                };
                            } else if (!card.image_uris && card.image_url) {
                                card.image_uris = {
                                    isDoubleFaced: false,
                                    front: { normal: card.image_url }
                                };
                            }
                            
                            this.cards.set(card.id, card);
                        }
                    }
                }
            }
            
            console.log(`Loaded ${this.cards.size} cards from files`);
            
        } catch (error) {
            console.error('Error loading card data:', error.message);
            throw error;
        }
    }

    async makeScryfallRequest(url, retryCount = 0) {
        try {
            await this.rateLimiter.waitForSlot();
            
            if (retryCount > 0) {
                const baseDelay = this.retryDelay;
                const maxDelay = baseDelay * Math.pow(2, retryCount - 1);
                const jitter = Math.random() * 0.3 * maxDelay;
                const delay = Math.min(maxDelay + jitter, 30000);
                
                await this.logger.info(`Retry ${retryCount}/${this.maxRetries}: Waiting ${Math.round(delay)}ms before retrying...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }

            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'MTG-AI-Builder/1.0 (https://github.com/yourusername/mtg-ai-builder)'
                },
                timeout: 10000
            });
            return response.data;
        } catch (error) {
            if (error.response) {
                const status = error.response.status;
                const isRetryable = status === 503 || status === 429 || status === 500;
                
                if (isRetryable && retryCount < this.maxRetries) {
                    await this.logger.warn(`Received ${status} error, retrying (${retryCount + 1}/${this.maxRetries})...`, {
                        error: error.response.data
                    });
                    return this.makeScryfallRequest(url, retryCount + 1);
                }
                
                await this.logger.error(`Non-retryable error (${status})`, {
                    error: error.response.data || error.message
                });
            } else if (error.request) {
                if (retryCount < this.maxRetries) {
                    await this.logger.warn(`Network error, retrying (${retryCount + 1}/${this.maxRetries})...`);
                    return this.makeScryfallRequest(url, retryCount + 1);
                }
                await this.logger.error('Network error', { error: error.message });
            } else {
                await this.logger.error('Request error', { error: error.message });
            }
            throw error;
        }
    }

    async loadCardData() {
        try {
            let hasMore = true;
            let nextPage = 'https://api.scryfall.com/cards/search?q=f:commander&unique=cards';
            let totalCards = 0;
            let pageCount = 0;
            let errorCount = 0;
            const maxErrors = 5;
            const batchSize = 175; // Cards per page
            const progressFile = path.join(this.cardsDir, 'progress.json');

            await this.logger.info('Starting card fetch process');
            
            // Try to load progress if exists
            let lastProcessedPage = 0;
            try {
                const progressData = await fs.readFile(progressFile, 'utf8');
                const progress = JSON.parse(progressData);
                lastProcessedPage = progress.lastProcessedPage || 0;
                totalCards = progress.totalCards || 0;
                await this.logger.info(`Resuming from page ${lastProcessedPage + 1}`, {
                    totalCards,
                    lastProcessedPage
                });
            } catch (error) {
                await this.logger.info('No progress file found, starting fresh');
            }
            
            while (hasMore && errorCount < maxErrors) {
                try {
                    pageCount++;
                    
                    if (pageCount <= lastProcessedPage) {
                        await this.logger.debug(`Skipping already processed page ${pageCount}`);
                        continue;
                    }
                    
                    await this.logger.info(`Fetching page ${pageCount}`);
                    
                    const data = await this.makeScryfallRequest(nextPage);
                    const cards = data.data;
                    
                    await this.logger.info(`Processing ${cards.length} cards on page ${pageCount}`);
                    
                    const batches = [];
                    for (let i = 0; i < cards.length; i += 10) {
                        batches.push(cards.slice(i, i + 10));
                    }
                    
                    for (const batch of batches) {
                        await Promise.all(batch.map(card => this.processCard(card)));
                        totalCards += batch.length;
                        
                        if (totalCards % 100 === 0) {
                            await this.logger.info(`Processed ${totalCards} cards so far`);
                            
                            await fs.writeFile(progressFile, JSON.stringify({
                                lastProcessedPage: pageCount,
                                totalCards: totalCards,
                                timestamp: new Date().toISOString()
                            }));
                        }
                    }
                    
                    hasMore = data.has_more;
                    if (hasMore) {
                        nextPage = data.next_page;
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                } catch (error) {
                    errorCount++;
                    await this.logger.error(`Error on page ${pageCount}`, {
                        error: error.message,
                        response: error.response?.data
                    });
                    
                    if (errorCount >= maxErrors) {
                        await this.logger.error(`Too many errors (${errorCount}), stopping fetch`);
                        break;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay * 4));
                }
            }
            
            try {
                await fs.unlink(progressFile);
            } catch (error) {
                // Ignore error if file doesn't exist
            }
            
            await this.logger.info('Card fetch process completed', {
                totalCards,
                uniqueCards: this.cards.size
            });
            
            await this.logCardStatistics();
            
        } catch (error) {
            await this.logger.error('Error in loadCardData', {
                error: error.message,
                response: error.response?.data
            });
            throw error;
        }
    }

    async logCardStatistics() {
        const cardTypes = new Map();
        const colorIdentities = new Map();
        
        this.cards.forEach(card => {
            // Count card types
            const type = card.type_line.split(' — ')[0];
            cardTypes.set(type, (cardTypes.get(type) || 0) + 1);
            
            // Count color identities
            const colors = card.color_identity.join('');
            colorIdentities.set(colors, (colorIdentities.get(colors) || 0) + 1);
        });
        
        console.log('\nCard Type Distribution:');
        cardTypes.forEach((count, type) => {
            console.log(`${type}: ${count} cards`);
        });
        
        console.log('\nColor Identity Distribution:');
        colorIdentities.forEach((count, colors) => {
            console.log(`${colors || 'Colorless'}: ${count} cards`);
        });
    }

    async processCard(card) {
        // Break down the card into its components
        const components = this.breakdownCard(card);
        
        // Create embeddings for each component
        const embeddings = {};
        for (const [key, text] of Object.entries(components)) {
            if (text) {
                embeddings[key] = await this.createEmbedding(text);
            }
        }
        
        // Handle cards with multiple faces
        let image_uris;
        if (card.card_faces && card.card_faces.length > 0) {
            // Double-faced card
            image_uris = {
                isDoubleFaced: true,
                front: card.card_faces[0].image_uris || {
                    normal: card.card_faces[0].image_url || null,
                    small: card.card_faces[0].image_url || null,
                    large: card.card_faces[0].image_url || null
                },
                back: card.card_faces[1].image_uris || {
                    normal: card.card_faces[1].image_url || null,
                    small: card.card_faces[1].image_url || null,
                    large: card.card_faces[1].image_url || null
                }
            };
        } else if (card.image_uris) {
            // Single-faced card with image_uris
            image_uris = {
                isDoubleFaced: false,
                front: card.image_uris
            };
        } else if (card.image_url) {
            // Single-faced card with image_url
            image_uris = {
                isDoubleFaced: false,
                front: {
                    normal: card.image_url,
                    small: card.image_url,
                    large: card.image_url
                }
            };
        } else {
            // Fallback for cards without images
            image_uris = {
                isDoubleFaced: false,
                front: {
                    normal: null,
                    small: null,
                    large: null
                }
            };
        }
        
        // Store the card with its components and embeddings
        this.cards.set(card.id, {
            id: card.id,
            name: card.name,
            type_line: card.type_line,
            oracle_text: card.oracle_text || (card.card_faces ? card.card_faces.map(face => face.oracle_text).join('\n\n') : ''),
            mana_cost: card.mana_cost || (card.card_faces ? card.card_faces[0].mana_cost : ''),
            cmc: card.cmc,
            colors: card.colors || [],
            color_identity: card.color_identity || [],
            keywords: card.keywords || [],
            power: card.power,
            toughness: card.toughness,
            loyalty: card.loyalty,
            rarity: card.rarity,
            set: card.set,
            set_name: card.set_name,
            collector_number: card.collector_number,
            scryfall_uri: card.scryfall_uri,
            image_uris: image_uris,
            card_faces: card.card_faces || null,
            prices: card.prices || {},
            legalities: card.legalities || {},
            edhrec_rank: card.edhrec_rank,
            penny_rank: card.penny_rank,
            preview: card.preview,
            related_uris: card.related_uris || {},
            purchase_uris: card.purchase_uris || {},
            components: components,
            embeddings: embeddings
        });
    }

    breakdownCard(card) {
        return {
            name: card.name,
            type: card.type_line,
            manaCost: card.mana_cost,
            keywords: card.keywords.join(' '),
            colorIdentity: card.color_identity.join(''),
            stats: card.power && card.toughness ? `${card.power}/${card.toughness}` : '',
            abilities: this.parseAbilities(card.oracle_text),
            theme: this.extractTheme(card)  // New theme component
        };
    }

    parseAbilities(oracleText) {
        if (!oracleText) return '';
        
        // Split oracle text into sentences and clean them
        const sentences = oracleText
            .split(/[.!?]+/)
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .map(sentence => {
                // Remove mana symbols and replace with their text representation
                let processedSentence = sentence.replace(/\{([^}]+)\}/g, (match, p1) => {
                    // Convert mana symbols to text
                    if (p1.match(/^[WUBRG]$/)) {
                        return p1.toLowerCase() + ' mana';
                    }
                    if (p1.match(/^\d+$/)) {
                        return p1 + ' generic mana';
                    }
                    return match;
                });
                
                // Extract cost and effect if present
                const costEffectMatch = processedSentence.match(/^([^:]+):\s*(.+)$/);
                if (costEffectMatch) {
                    return `${costEffectMatch[1].trim()} ${costEffectMatch[2].trim()}`;
                }
                
                // Extract trigger condition and effect if present
                const triggerMatch = processedSentence.match(/^([^,]+),\s*(.+)$/);
                if (triggerMatch) {
                    return `${triggerMatch[1].trim()} ${triggerMatch[2].trim()}`;
                }
                
                return processedSentence;
            });
        
        return sentences.join(' ');
    }

    extractTheme(card) {
        const themeElements = [];
        
        // Extract creature types for tribal themes
        if (card.type_line) {
            const types = card.type_line.split(' — ')[1]?.split(' ') || [];
            themeElements.push(...types);
        }
        
        // Extract keywords for mechanical themes
        if (card.keywords) {
            themeElements.push(...card.keywords);
        }
        
        // Extract ability themes
        if (card.oracle_text) {
            const abilityThemes = this.extractAbilityThemes(card.oracle_text);
            themeElements.push(...abilityThemes);
        }
        
        return themeElements.join(' ');
    }

    extractAbilityThemes(oracleText) {
        const themes = [];
        const themeKeywords = [
            'counter', 'draw', 'destroy', 'exile', 'sacrifice', 'token',
            'equipment', 'aura', 'artifact', 'enchantment', 'land',
            'graveyard', 'library', 'hand', 'battlefield',
            'creature', 'planeswalker', 'instant', 'sorcery'
        ];
        
        themeKeywords.forEach(keyword => {
            if (oracleText.toLowerCase().includes(keyword)) {
                themes.push(keyword);
            }
        });
        
        return themes;
    }

    async createEmbedding(text) {
        // Ensure text is a string
        if (typeof text !== 'string') {
            if (Array.isArray(text)) {
                text = text.join(' ');
            } else if (typeof text === 'object') {
                text = JSON.stringify(text);
            } else {
                text = String(text);
            }
        }

        // Create a simple bag-of-words vector
        const vector = new Array(this.vectorDimension).fill(0);
        
        // Split text into words and create embedding
        const words = text.toLowerCase().split(/\s+/);
        words.forEach(word => {
            const hash = this.hashString(word);
            const index = Math.abs(hash) % this.vectorDimension;
            vector[index] += 1;
        });
        
        // Normalize the vector
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        return vector.map(val => val / magnitude);
    }

    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash;
    }

    cosineSimilarity(vec1, vec2) {
        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;
        
        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            norm1 += vec1[i] * vec1[i];
            norm2 += vec2[i] * vec2[i];
        }
        
        return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    }

    // Get all cards
    getAllCards() {
        return Array.from(this.cards.values());
    }

    // Get a specific card by ID
    getCard(cardId) {
        return this.cards.get(cardId);
    }

    // Get cards by name (case-insensitive partial match)
    getCardsByName(name) {
        const searchName = name.toLowerCase();
        return Array.from(this.cards.values())
            .filter(card => card.name.toLowerCase().includes(searchName));
    }

    // Get cards by type (case-insensitive partial match)
    getCardsByType(type) {
        const searchType = type.toLowerCase();
        return Array.from(this.cards.values())
            .filter(card => card.type_line.toLowerCase().includes(searchType));
    }

    // Get cards by color identity
    getCardsByColorIdentity(colors) {
        const searchColors = colors.map(c => c.toLowerCase());
        return Array.from(this.cards.values())
            .filter(card => {
                const cardColors = card.color_identity.map(c => c.toLowerCase());
                return searchColors.every(color => cardColors.includes(color));
            });
    }

    // Get cards by mana value (CMC)
    getCardsByManaValue(cmc) {
        return Array.from(this.cards.values())
            .filter(card => card.cmc === cmc);
    }

    // Get cards by rarity
    getCardsByRarity(rarity) {
        const searchRarity = rarity.toLowerCase();
        return Array.from(this.cards.values())
            .filter(card => card.rarity.toLowerCase() === searchRarity);
    }

    // Get cards by set
    getCardsBySet(set) {
        const searchSet = set.toLowerCase();
        return Array.from(this.cards.values())
            .filter(card => card.set.toLowerCase() === searchSet);
    }

    // Get cards by EDHREC rank range
    getCardsByEDHRECRank(min, max) {
        return Array.from(this.cards.values())
            .filter(card => card.edhrec_rank >= min && card.edhrec_rank <= max);
    }

    // Find similar cards based on a specific component
    findSimilarCards(cardId, component = 'abilities', limit = 5) {
        const sourceCard = this.cards.get(cardId);
        if (!sourceCard) return [];

        const sourceEmbedding = sourceCard.embeddings[component];
        if (!sourceEmbedding) return [];

        return Array.from(this.cards.values())
            .filter(card => card.id !== cardId)
            .map(card => ({
                card: card,
                similarity: this.cosineSimilarity(sourceEmbedding, card.embeddings[component])
            }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }

    // Add concurrency-safe cache methods
    async getFromCache(key) {
        // Check if there's a lock for this key
        if (this.cacheLocks.has(key)) {
            // Wait for the lock to be released
            await this.cacheLocks.get(key);
        }

        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        return null;
    }

    async setCache(key, data) {
        // Create a lock for this key
        const lock = new Promise(resolve => {
            this.cacheLocks.set(key, resolve);
        });

        try {
            this.cache.set(key, {
                data,
                timestamp: Date.now()
            });
        } finally {
            // Release the lock
            this.cacheLocks.delete(key);
        }
    }

    // Add concurrency-safe search method
    async searchCards(query, options = {}) {
        // Ensure service is initialized
        await this.initialize();

        const cacheKey = JSON.stringify({ query, options });
        
        // Try to get from cache first
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        // If not in cache, perform search
        const results = await this.performSearch(query, options);
        
        // Cache results
        await this.setCache(cacheKey, results);
        
        return results;
    }

    // Separate search logic for better concurrency
    async performSearch(query, options = {}) {
        const {
            limit = 20,
            minSimilarity = 0.2,
            searchComponents = ['name', 'type', 'abilities', 'theme'],
            colorIdentity = null,
            cardType = null,
            cmc = null,
            rarity = null,
            isCommanderSearch = false
        } = options;

        // Create embedding for the search query
        const queryEmbedding = await this.createEmbedding(query);

        // Get all cards that match the basic filters
        let candidates = Array.from(this.cards.values());

        // Apply basic filters first
        if (colorIdentity) {
            const colors = Array.isArray(colorIdentity) ? colorIdentity : [colorIdentity];
            candidates = candidates.filter(card => {
                return colors.every(color => card.color_identity.includes(color)) &&
                       card.color_identity.length === colors.length;
            });
        }

        if (cardType) {
            candidates = candidates.filter(card => 
                card.type_line.toLowerCase().includes(cardType.toLowerCase())
            );
        }

        // Calculate similarity scores for each component
        const results = candidates.map(card => {
            let totalSimilarity = 0;
            let componentCount = 0;

            for (const component of searchComponents) {
                if (card.embeddings[component]) {
                    const similarity = this.cosineSimilarity(
                        queryEmbedding,
                        card.embeddings[component]
                    );
                    totalSimilarity += similarity;
                    componentCount++;
                }
            }

            const avgSimilarity = componentCount > 0 ? totalSimilarity / componentCount : 0;

            return {
                card,
                similarity: avgSimilarity
            };
        });

        // Filter by minimum similarity and sort by highest similarity
        return results
            .filter(result => result.similarity >= minSimilarity)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }

    // Add method to handle concurrent cache cleanup
    async cleanupCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.cacheTimeout) {
                this.cache.delete(key);
            }
        }
    }

    async validateCardData() {
        try {
            console.log('Validating card data...');
            
            const validationResults = {
                total: this.cards.size,
                valid: 0,
                invalid: 0,
                errors: []
            };
            
            for (const [id, card] of this.cards) {
                try {
                    // Check required fields
                    const requiredFields = ['name', 'type_line', 'oracle_text', 'mana_cost', 'cmc', 'color_identity'];
                    const missingFields = requiredFields.filter(field => !card[field]);
                    
                    if (missingFields.length > 0) {
                        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
                    }
                    
                    // Validate color identity
                    if (!Array.isArray(card.color_identity)) {
                        throw new Error('Color identity must be an array');
                    }
                    
                    // Validate image URIs
                    if (!card.image_uris && !card.card_faces) {
                        throw new Error('Missing image URIs');
                    }
                    
                    // Validate card faces if present
                    if (card.card_faces && (!Array.isArray(card.card_faces) || card.card_faces.length !== 2)) {
                        throw new Error('Invalid card faces data');
                    }
                    
                    validationResults.valid++;
                    
                } catch (error) {
                    validationResults.invalid++;
                    validationResults.errors.push({
                        id,
                        name: card.name,
                        error: error.message
                    });
                }
            }
            
            // Log validation results
            console.log('\nValidation Results:');
            console.log(`Total cards: ${validationResults.total}`);
            console.log(`Valid cards: ${validationResults.valid}`);
            console.log(`Invalid cards: ${validationResults.invalid}`);
            
            if (validationResults.errors.length > 0) {
                console.log('\nValidation Errors:');
                validationResults.errors.forEach(({ id, name, error }) => {
                    console.log(`${name} (${id}): ${error}`);
                });
            }
            
            return validationResults;
            
        } catch (error) {
            console.error('Error validating card data:', error.message);
            throw error;
        }
    }

    // Add method to preload popular cards
    async preloadPopularCards() {
        try {
            await this.logger.info('Preloading popular cards...');
            
            // Get cards by EDHREC rank
            const popularCards = this.getCardsByEDHRECRank(1, 100);
            
            // Cache each card's data
            for (const card of popularCards) {
                const cacheKey = `card_${card.id}`;
                this.setCache(cacheKey, card);
            }
            
            await this.logger.info(`Preloaded ${popularCards.length} popular cards`);
        } catch (error) {
            await this.logger.error('Error preloading popular cards', { error: error.message });
        }
    }

    // Add method to check storage space
    async checkStorageSpace() {
        try {
            const totalSize = await this.getDirectorySize(this.cardsDir);
            const maxSize = 1024 * 1024 * 1024; // 1GB limit for Render free tier
            
            if (totalSize > maxSize) {
                await this.logger.warn('Storage space approaching limit', {
                    currentSize: totalSize,
                    maxSize: maxSize
                });
                return false;
            }
            return true;
        } catch (error) {
            await this.logger.error('Error checking storage space', { error: error.message });
            return false;
        }
    }

    // Add method to get directory size
    async getDirectorySize(dirPath) {
        let totalSize = 0;
        const files = await fs.readdir(dirPath);
        
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stats = await fs.stat(filePath);
            
            if (stats.isDirectory()) {
                totalSize += await this.getDirectorySize(filePath);
            } else {
                totalSize += stats.size;
            }
        }
        
        return totalSize;
    }
}

module.exports = CardEmbeddingService; 