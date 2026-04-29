const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "OK" };

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
         return { statusCode: 200, headers, body: JSON.stringify({ reply: "Falta la API Key en Netlify." }) };
    }

    try {
        const body = JSON.parse(event.body);
        const userMessage = body.message;
        const chatHistory = body.history || []; // Recibimos la memoria de la conversación

        const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

        // 1. LEER PDFs
        let pdfFolder = path.join(__dirname, 'pdfs');
        if (!fs.existsSync(pdfFolder)) {
            pdfFolder = path.join(process.cwd(), 'netlify/functions/pdfs');
        }

        let fullText = "";
        if (fs.existsSync(pdfFolder)) {
            const files = fs.readdirSync(pdfFolder).filter(file => file.toLowerCase().endsWith('.pdf'));
            for (const file of files) {
                const dataBuffer = fs.readFileSync(path.join(pdfFolder, file));
                const data = await pdf(dataBuffer);
                fullText += `\n--- MANUAL: ${file} ---\n` + data.text + "\n";
            }
        }

        // 2. CHUNKING CON SOLAPAMIENTO
        const lines = fullText.split(/\n/);
        let chunks = [];
        let currentChunk = "";
        
        for (const line of lines) {
            if (line.trim() === "") continue;
            currentChunk += line + " "; 
            if (currentChunk.length > 1200) {
                chunks.push(currentChunk);
                currentChunk = currentChunk.substring(currentChunk.length - 300);
            }
        }
        if (currentChunk.length > 0) chunks.push(currentChunk);

        // 3. BÚSQUEDA INTELIGENTE
        const normalizedMessage = normalize(userMessage);
        let keywords = normalizedMessage.split(/\W+/).filter(w => w.length > 3);
        if (keywords.length === 0) keywords = [normalizedMessage.trim()];

        const scoredChunks = chunks.map(chunk => {
            let score = 0;
            const normalizedChunk = normalize(chunk);
            keywords.forEach(word => {
                const root = word.endsWith('s') ? word.slice(0, -1) : word;
                const regex = new RegExp(root, 'g');
                const matches = normalizedChunk.match(regex);
                if (matches) score += matches.length; 
            });
            return { text: chunk, score: score };
        });

        let relevantContext = scoredChunks
            .filter(c => c.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 10) 
            .map(c => c.text)
            .join("\n\n[...]\n\n");

        if (!relevantContext) {
            relevantContext = fullText.substring(0, 3000); 
        }

        // 4. INSTRUCCIONES MEJORADAS (Menú de opciones)
        const systemInstruction = `
        Eres IA-AGORA, asistente técnico experto en el software Ágora.
        
        REGLAS ESTRICTAS:
        1. Responde basándote EXCLUSIVAMENTE en los fragmentos del manual proporcionados.
        2. AHORRO DE TOKENS (SÚPER IMPORTANTE): Si la pregunta del usuario es amplia y existen varios procedimientos, opciones o tipos sobre ese tema en el manual, NO expliques todos los pasos de todas las opciones de golpe. En su lugar, dale un resumen breve indicando las opciones disponibles en viñetas y pregúntale al usuario sobre cuál de ellas quiere que le des los detalles exactos.
        3. Si el usuario ya te está concretando una opción específica (porque le preguntaste antes), dale entonces sí los pasos detallados de esa opción.
        4. NO INVENTES opciones, botones ni menús. Si no está en el texto, di: "No encuentro ese procedimiento en los manuales indexados."

        FRAGMENTOS DEL MANUAL:
        ${relevantContext}
        `;

        // 5. LLAMADA A GEMINI CON HISTORIAL
        const apiContents = [...chatHistory, { role: "user", parts: [{ text: userMessage }] }];

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: apiContents,
                generationConfig: { temperature: 0.1 } 
            })
        });

        const data = await response.json();
        
        if (!response.ok || data.error) {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: `ERROR: ${data.error?.message}` }) };
        }

        if (data.candidates && data.candidates[0].content) {
            const replyText = data.candidates[0].content.parts[0].text;
            return { statusCode: 200, headers, body: JSON.stringify({ reply: replyText }) };
        } else {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: `Error o respuesta bloqueada por seguridad.` }) };
        }

    } catch (error) {
        return { statusCode: 200, headers, body: JSON.stringify({ reply: `Error del servidor: ${error.message}` }) };
    }
};