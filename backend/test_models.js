const fs = require('fs');
require('dotenv').config({ path: './.env' });
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
    try {
        const testKey = process.env.GEMINI_API_KEY;
        const genAI = new GoogleGenerativeAI(testKey);

        const models = [
            'gemini-2.5-flash-lite',
            'gemini-flash-lite-latest',
            'gemini-3.1-flash-lite-preview',
            'gemini-2.5-flash',
            'gemini-flash-latest'
        ];

        let log = "";
        for (const modelId of models) {
            try {
                const model = genAI.getGenerativeModel({ model: modelId, generationConfig: { responseMimeType: "application/json" } });
                const startTime = Date.now();
                const result = await model.generateContent("{\"isRelevant\": true, \"confidence\": 0.9, \"reasoning\": \"test\"}");
                const latency = Date.now() - startTime;
                log += `✅ ${modelId}: SUCCESS - ${latency}ms - ${result.response.text()}\n`;
            } catch (err) {
                log += `❌ ${modelId}: FAILED - ${err.message}\n`;
            }
        }
        fs.writeFileSync('test_output2.txt', log, 'utf8');
        console.log("Results written to test_output2.txt");
    } catch (error) {
        console.error('List models error:', error);
    }
}

listModels();
