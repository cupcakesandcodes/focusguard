const fs = require('fs');
require('dotenv').config({ path: './.env' });

async function dumpModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        fs.writeFileSync('models_api_dump.json', JSON.stringify(data, null, 2), 'utf8');
        console.log('Successfully dumped models to models_api_dump.json');
    } catch (error) {
        console.error('Fetch error:', error.message);
    }
}

dumpModels();
