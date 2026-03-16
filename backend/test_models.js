require('dotenv').config({ path: './.env' });
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
    try {
        const testKey = 'AIzaSyBafrzNNNHbrlH3DDOpUyZphjyt_Lz4llI';
        const genAI = new GoogleGenerativeAI(testKey);
        console.log('Using Test API Key (Roamly)');

        // Use the native method if available, or fetch manually
        // The SDK might not expose listModels directly in older versions, but let's check
        // Actually, we can just try to generate content with a few variations

        const models = [
            'gemini-1.5-flash',
            'gemini-1.5-flash-latest',
            'gemini-2.0-flash-exp',
            'gemini-2.0-flash-lite-preview-02-05'
        ];

        for (const modelId of models) {
            try {
                const model = genAI.getGenerativeModel({ model: modelId });
                const result = await model.generateContent("Hi");
                console.log(`✅ ${modelId}: SUCCESS`);
            } catch (err) {
                console.log(`❌ ${modelId}: FAILED - ${err.message}`);
            }
        }
    } catch (error) {
        console.error('List models error:', error);
    }
}

listModels();
