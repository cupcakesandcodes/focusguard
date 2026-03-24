require('dotenv').config({ path: './.env' });

async function listModelsManual() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        console.log('Fetching available models from v1beta via native fetch...');
        const response = await fetch(url);
        const data = await response.json();

        if (data.models) {
            console.log('Available Models:');
            data.models.forEach(m => {
                console.log(`- ${m.name} (${m.displayName})`);
            });
        } else {
            console.log('No models found or error response:', JSON.stringify(data, null, 2));
        }
    } catch (error) {
        console.error('Fetch error:', error.message);
    }
}

listModelsManual();
