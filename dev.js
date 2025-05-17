const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Check if .env exists
if (!fs.existsSync('.env')) {
    console.error('\x1b[31mError: .env file not found!\x1b[0m');
    console.log('\x1b[33mPlease create a .env file with the following contents:\x1b[0m');
    console.log(`
# OpenAI Configuration
OPENAI_API_KEY=your_api_key_here
OPENAI_ORGANIZATION_ID=your_org_id_here

# Server Configuration
PORT=3000
NODE_ENV=development

# API URLs
PRODUCTION_URL=https://jjdb.onrender.com
DEVELOPMENT_URL=http://localhost:3000
`);
    process.exit(1);
}

// Load and validate environment
require('dotenv').config();

const requiredVars = ['OPENAI_API_KEY'];
const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('\x1b[31mError: Missing required environment variables:\x1b[0m');
    missingVars.forEach(varName => {
        console.error(`- ${varName}`);
    });
    process.exit(1);
}

// Update script.js BACKEND_URL
const scriptPath = path.join(__dirname, 'script.js');
let scriptContent = fs.readFileSync(scriptPath, 'utf8');

// Replace the BACKEND_URL with development URL
scriptContent = scriptContent.replace(
    /const BACKEND_URL = ['"].*['"];/,
    `const BACKEND_URL = 'http://localhost:${process.env.PORT || 3000}';  // Development URL`
);

fs.writeFileSync(scriptPath, scriptContent);
console.log('\x1b[32mUpdated script.js to use development backend URL\x1b[0m');

// Start the server
console.log('\x1b[36mStarting development server...\x1b[0m');
const server = spawn('node', ['server.js'], { stdio: 'inherit' });

// Handle server process
server.on('error', (err) => {
    console.error('\x1b[31mFailed to start server:\x1b[0m', err);
});

// Handle cleanup
process.on('SIGINT', () => {
    console.log('\n\x1b[36mShutting down development server...\x1b[0m');
    server.kill();
    
    // Restore script.js to production URL
    scriptContent = scriptContent.replace(
        /const BACKEND_URL = ['"].*['"];/,
        `const BACKEND_URL = 'https://jjdb.onrender.com';  // Production URL`
    );
    fs.writeFileSync(scriptPath, scriptContent);
    console.log('\x1b[32mRestored script.js to production backend URL\x1b[0m');
    
    process.exit();
}); 