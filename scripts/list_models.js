require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_KEY) {
  console.error('Missing GEMINI_API_KEY in .env');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_KEY);

const modelsToTest = [
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro',
  'gemini-1.5-pro-latest',
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
  'gemini-pro',
  'gemini-pro-vision'
];

(async () => {
  console.log('🔍 Testing available Gemini models...\n');
  
  for (const modelName of modelsToTest) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent('Test');
      console.log(`✅ ${modelName} - WORKING`);
    } catch (err) {
      console.log(`❌ ${modelName} - ${err.message.split('\n')[0]}`);
    }
  }
  
  console.log('\n✨ Done testing models');
})();
